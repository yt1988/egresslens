// The built pages keep the 1ms.dog tool contract (see the README): what the shared top bar relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LANGS, LANDS, loadI18n } from "../scripts/build.mjs";
import { PROBES } from "../src/probes.mjs";

const I = await loadI18n();
const page = async slug => readFile(new URL(`../public/${slug ? slug + "/" : ""}index.html`, import.meta.url), "utf8");

// Every absolute URL a shipped page or script may name: this tool's own domain and the third parties it probes or
// links to. This site's measurement and service endpoints are not third parties, so none of them may appear.
const ALLOWED_HOSTS = new Set([
  "egress.1ms.dog", "github.com", "schema.org",
  // an SVG's namespace: a name, never fetched (Dark Reader serializes the icon and re-decodes it standalone)
  "www.w3.org",
  ...PROBES.flatMap(p => (p.url && /^https?:/.test(p.url) ? [new URL(p.url).host] : [])),
]);
const hostsIn = s => [...s.matchAll(/https?:\/\/([^/"'\s<>)]+)/g)].map(m => m[1].replace(/:\d+$/, ""));
const assertHostsAllowed = (s, where) => {
  for (const host of new Set(hostsIn(s))) assert.ok(ALLOWED_HOSTS.has(host), `${where}: unexpected host ${host}`);
};

test("every language has every string, with the same placeholders", () => {
  for (const [l] of LANGS) {
    assert.ok(I[l], "missing language " + l);
    for (const [k, v] of Object.entries(I.en)) {
      assert.ok(k in I[l], `${l}: missing ${k}`);
      if (typeof v === "string") assert.deepEqual((I[l][k].match(/\{\w+\}/g) || []).sort(), (v.match(/\{\w+\}/g) || []).sort(), `${l}: placeholders of ${k}`);
    }
    assert.equal(I[l].faq.length, I.en.faq.length, l + ": faq");
  }
});

test("pages: charset first, standard lang, no inline styles, every probe listed", async () => {
  for (const [l, slug] of LANGS) {
    const h = await page(slug);
    assert.match(h, /^<!doctype html>\n<html lang="[a-zA-Z-]+"/);
    assert.equal(h.match(/<html lang="([^"]+)"/)[1], l);
    assert.match(h, /<head>\n<meta charset="utf-8">\n<script>/);
    assert.ok(!/\sstyle="/.test(h), l + ": inline style attribute");
    assert.ok(/<body>/.test(h) && /<\/head>/.test(h));
    assert.ok(/select option, ?select optgroup/.test(await readFile(new URL("../public/assets/" + /app\.[0-9a-f]+\.css/.exec(h)[0], import.meta.url), "utf8")));
    assert.ok(h.length < 60_000, l + ": page too big");
  }
});

// Visible text that is not in the strings files is a brand (the same everywhere) or a gap: on every other language's
// page, an aria-label, title or alt that reads exactly like the English page's must be one of these.
const BRANDS = new Set(["", "1ms", "GitHub", "EgressLens"]);
test("no English left on other languages' pages (aria-label, title, alt)", async () => {
  const attrs = h => [...h.matchAll(/s(aria-label|title|alt)="([^"]*)"/g)].map(m => m[2]).filter(v => !/^https?:/.test(v));
  const en = new Set(attrs(await page("")));
  for (const [l, slug] of LANGS.slice(1)) {
    const leaks = attrs(await page(slug)).filter(v => en.has(v) && !BRANDS.has(v) && !/^[w.-]+.[a-z]{2,}$/.test(v));
    assert.deepEqual([...new Set(leaks)], [], l + ": untranslated");
  }
});

test("share cards: every page has its og image, every verdict its result page and image", async () => {
  const { access } = await import("node:fs/promises");
  const { VERDICTS } = await import("../src/lib.mjs");
  const has = f => access(new URL("../public/" + f, import.meta.url)).then(() => true, () => false);
  // the shared dialog (1ms-shell assets/share/), copied verbatim; 1ms-shell checks the copies match
  for (const f of ["share.js", "share.css", "qr.js"]) assert.ok(await has("assets/share/" + f), f);
  for (const [l, slug] of LANGS) {
    const h = await page(slug);
    assert.match(h, /name="twitter:card" content="summary_large_image"/);
    assert.doesNotMatch(h, /id="shareDlg"/, l + ": the shared dialog replaces its own");
    assert.ok(await has(`og/${l.toLowerCase()}.png`), l + ": og image");
    for (const v of VERDICTS) {
      const r = await readFile(new URL(`../public/${slug ? slug + "/" : ""}r/${v}/index.html`, import.meta.url), "utf8");
      assert.match(r, new RegExp(`og:image" content="[^"]+/og/${l.toLowerCase()}/${v}\.png"`));
      assert.match(r, /name="robots" content="noindex/);
      assert.ok(await has(`og/${l.toLowerCase()}/${v}.png`), `${l}: ${v} image`);
    }
  }
});

test("landing pages: their own words, canonical to themselves, every language linked, in the sitemap", async () => {
  const sitemap = await readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  const { access } = await import("node:fs/promises");
  for (const land of LANDS) {
    const titles = new Set();
    for (const [l, slug] of LANGS) {
      const L = I[l]["lp_" + land.id], at = (slug ? slug + "/" : "") + land.slug + "/";
      for (const k of ["nav", "title", "desc", "kw", "h1", "intro"]) assert.equal(typeof L[k], "string", `${l} lp_${land.id}.${k}`);
      assert.equal(L.faq.length, I.en["lp_" + land.id].faq.length, `${l} lp_${land.id}.faq`);
      const h = await page(at.slice(0, -1));
      assert.ok(h.includes(`<title>${L.title.replace(/&/g, "&amp;")}</title>`), l + " title");
      assert.ok(h.includes(`>${L.h1.replace(/&/g, "&amp;")}</h1>`), l + " h1");
      assert.match(h, new RegExp(`<link rel="canonical" href="https://egress\.1ms\.dog/${at.replace(/\//g, "\/")}">`), `${l} ${land.slug} canonical`);
      for (const [, s2] of LANGS) assert.ok(h.includes(`href="https://egress.1ms.dog/${s2 ? s2 + "/" : ""}${land.slug}/"`), `${l} ${land.slug} hreflang ${s2}`);
      assert.ok(h.includes(`data-focus="${land.id}"`), `${l} ${land.slug}: lead panel`);
      if (land.id === "ai") assert.ok(h.includes(`data-m="home" data-at="chatgpt/"`) && h.includes(`>${I[l].lat_link}<svg xmlns="http://www.w3.org/2000/svg" class="xi"`), `${l}: link to the latency test`);
      assert.match(h, /"@type":"FAQPage"/);
      assert.ok(sitemap.includes(`<loc>https://egress.1ms.dog/${at}</loc>`), `${at} in the sitemap`);
      await access(new URL(`../public/og/${l.toLowerCase()}/${land.slug}.png`, import.meta.url));
      titles.add(L.title);
    }
    assert.equal(titles.size, LANGS.length, land.slug + ": a title per language");
  }
});


test("own probes wait for the injected endpoint metas", async () => {
  // every page draws this site's own probes hidden, and names no endpoint for them: only the tool's domain and
  // third parties appear; the app unhides what the injected metas gave it
  for (const [l, slug] of LANGS) {
    const h = await page(slug);
    for (const id of ["acn", "t443", "u3478", "cnt4433", "cnu3478"]) assert.ok(h.includes(`id="p-${id}" hidden`), `${l}: ${id}`);
    assert.match(h, /<div class="pg" data-g="own" hidden>/, l);
    assert.match(h, /<div class="pg" data-g="owncn" hidden>/, l);
    assertHostsAllowed(h, `${l}: page`);
  }
  const js = await readFile(new URL("../public/assets/" + /app\.[0-9a-f]+\.js/.exec(await page(""))[0], import.meta.url), "utf8");
  assertHostsAllowed(js, "app.js");
});

test("checkup embed: only from the host's <meta name=check>, messages to that origin alone, a compact layout", async () => {
  const src = await readFile(new URL("../src/app.js", import.meta.url), "utf8"), css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(src, /get\("embed"\) === "checkup" && !!at && from === at/);
  assert.match(src, /parent\.postMessage\(\{ ms: "checkup", v: 1, tool: "egress", \.\.\.m \}, EMBED\)/);
  assert.doesNotMatch(src, /postMessage\([^)]*"\*"\)/);
  for (const sel of [".top", ".foot", ".probes", ".bar .acts"]) assert.ok(css.includes(`:root[data-ms-embed] ${sel}`), "hides " + sel);
  // the link to the checkup: hidden until the host announces it, and in the intro, which the embed hides
  for (const [l, slug] of LANGS) assert.match(await page(slug), new RegExp(`<p class="intro">[^<]*<a class="xl" data-m="check" data-at="" target="_blank" rel="noopener" hidden>${I[l].check_link}<svg`), l + ": checkup link");
  assert.ok(css.includes(":root[data-ms-embed] .hero-h"));
});
