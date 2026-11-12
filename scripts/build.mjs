#!/usr/bin/env node
// Builds the static site in public/ from src/:
//   index.html, <lang>/index.html                 the page per language
//   <lang>/chatgpt-ip/                            landing page for one check (LANDS): own title, text and questions
//   r/<verdict>/index.html, <lang>/r/<verdict>/    the same page for a shared result: its preview card states the verdict
//                                                 (the result itself is in the link's hash; the og/ images: scripts/og.mjs)
//   assets/app.<hash>.js, assets/app.<hash>.css   app code and styles, shared and cached by every page
//   assets/l.<lang>.<hash>.js                     the strings the browser code needs, per language
//   sitemap.xml, robots.txt, llms.txt, _headers   SEO and security headers (CSP)
// Usage: node scripts/build.mjs          write the files
//        node scripts/build.mjs --check  exit 1 if anything is out of date, or the app code does not parse (CI)
// SITE_URL sets the address used in canonical links and the sitemap (default https://egress.1ms.dog).
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { PROBES, GROUPS } from "../src/probes.mjs";
import { CHECKS, VERDICTS } from "../src/lib.mjs";

const SITE = (process.env.SITE_URL || "https://egress.1ms.dog").replace(/\/+$/, "");
const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);
// language, URL folder, og:locale, name in its own language; the first is the root
// the external-link icon that ends a link to another 1ms.dog tool (the shared tool contract: no arrows)
const EXT = '<svg class="xi" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
// Landing pages: the same tool with one check up front. id: its strings (lp_<id>, an object per language) and the
// check-table row it leads with; group: the probe group listed first; skip: the main page's question it answers itself.
// (The WebRTC leak test is who.1ms.dog's /webrtc-leak/; the 1ms.dog shell sends this tool's old /webrtc-leak/ there.)
export const LANDS = [{ id: "ai", slug: "chatgpt-ip", group: "ai", skip: 1 }];
export const LANGS = [["en", "", "en_US", "English"], ["zh-CN", "zh-cn", "zh_CN", "简体中文"], ["zh-TW", "zh-tw", "zh_TW", "繁體中文"],
  ["ja", "ja", "ja_JP", "日本語"], ["ko", "ko", "ko_KR", "한국어"], ["es", "es", "es_ES", "Español"], ["fr", "fr", "fr_FR", "Français"],
  ["de", "de", "de_DE", "Deutsch"], ["pt", "pt", "pt_BR", "Português"], ["ru", "ru", "ru_RU", "Русский"]];

// Runs before first paint: apply the saved theme, and mark a shared result (#r=…) so its line has its space at once.
// On the English root and on every shared-result page, send visitors to their language's page (a saved choice first,
// then the browser languages); crawlers and readers of the page's language stay.
export const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("egress:theme");s=localStorage.getItem("egress:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(/^#r=/.test(location.hash))d.setAttribute("data-shared","");if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;try{var q=new URLSearchParams(location.search).get("lang");if(P[q])l=q}catch(e){}if(!l&&P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!==d.lang)location.replace(P[l]+location.hash)})();`;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, v) => { for (const k in v) s = s.split("{" + k + "}").join(v[k]); return s; };
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");

// Windows sometimes holds a just-written file for a moment (antivirus, the preview server): retry before failing
async function writeRetry(url, text) {
  for (let i = 0; ; i++) {
    try { return await writeFile(url, text); }
    catch (e) { if (i >= 4 || !["UNKNOWN", "EBUSY", "EPERM"].includes(e.code)) throw e; await new Promise(r => setTimeout(r, 150 * (i + 1))); }
  }
}

export async function loadI18n() {
  const out = {};
  for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs")))
    out[f.slice(0, -4)] = (await import(new URL("i18n/" + f, src).href + "?" + Date.now())).default;
  return out;
}

export async function build({ check = false } = {}) {
  const I = await loadI18n(), en = I.en;
  const langs = LANGS.filter(([l]) => I[l]);
  const tpl = await readFile(new URL("page.html", src), "utf8");

  // src/lib.mjs (the pure logic the tests import) goes inside the app's scope, at its /* @lib */ marker
  const lib = (await readFile(new URL("lib.mjs", src), "utf8")).replace(/^export /gm, "");
  const appSrc = await readFile(new URL("app.js", src), "utf8");
  if (!appSrc.includes("/* @lib */")) throw new Error("src/app.js has no /* @lib */ marker");
  const probes = PROBES.map(({ id, g, name, host, url, read, fam, self }) => ({ id, g, name, host, url, read, ...(fam ? { fam } : {}), ...(self ? { self } : {}) }));
  const appFull = `const PROBES = ${JSON.stringify(probes)}, GROUPS = ${JSON.stringify(GROUPS)};\n` + appSrc.replace("/* @lib */", () => lib);
  new Function(appFull);                                                // must parse
  const cssFull = (await Promise.all(["fonts.css", "base.css", "style.css"].map(f => readFile(new URL(f, src), "utf8")))).join("\n");
  // minified with esbuild (pinned version, so the output, and its hash, only changes when the source does)
  const js = (await transform(appFull, { loader: "js", minify: true, target: ["es2019", "chrome70", "safari12", "firefox68", "edge79"], legalComments: "none" })).code;
  const css = (await transform(cssFull, { loader: "css", minify: true, legalComments: "none" })).code;
  const jsName = `app.${hash(js)}.js`, cssName = `app.${hash(css)}.css`;

  // static text the page already shows is not needed at runtime
  const RUNTIME_SKIP = new Set(["seo_title", "seo_desc", "seo_kw", "h1", "intro", "faq", "faq_h", "foot", "lang_label", "probes_h", "exits_h", "finds_h", "close", "r_desc", "rtc_nav", "check_link", "lat_link", ...LANDS.map(l => "lp_" + l.id), ...CHECKS.map(r => "r_" + r)]);
  const path = slug => "/" + (slug ? slug + "/" : "");
  const N = PROBES.length;
  const pages = [], files = {};
  for (const [lang, slug, locale] of langs) {
    // no fallback to English: a string missing in this language stops the build
    const d = I[lang], T = k => { if (d[k] == null) throw new Error(`${lang}: missing string "${k}"`); return d[k]; };
    const strings = Object.fromEntries(Object.keys(en).filter(k => !RUNTIME_SKIP.has(k)).map(k => [k, T(k)]));
    const sjs = `window.LEGRESS=${JSON.stringify(strings).replace(/</g, "\\u003c")};\n`;
    const sName = `l.${lang.toLowerCase()}.${hash(sjs)}.js`;
    files["assets/" + sName] = sjs;

    // every probe is in the HTML from the start (crawlers see what is checked; rows never move when results arrive)
    // one line per probe: name (host on hover), the address it saw, the exit label, Cloudflare colo, time
    // this site's own probe is named in the page's language, at the site's address
    const nameOf = p => p.self ? T("self_name") : p.name, hostOf = p => p.self ? new URL(SITE).host : p.host;
    const row = p => `<li class="pr" id="p-${p.id}"><span class="pn" title="${esc(hostOf(p))}">${esc(nameOf(p))}${p.fam ? ` <span class="m">v${p.fam}</span>` : ""}</span>` +
      `<span class="pip">–</span><span class="pl"></span><span class="pco"></span><span class="pms"></span></li>`;
    // only: a landing page lists just the groups it tests
    const groupsOf = (first, only) => [first, ...GROUPS.filter(g => g !== first)].filter(g => g && (!only || only.includes(g)))
      .map(g => `<div class="pg" data-g="${g}"><h3>${esc(T("g_" + g))}<b class="pg-n"></b></h3><ul>${PROBES.filter(p => p.g === g).map(row).join("")}</ul></div>`).join("\n");
    // the check table's rows: label now, status and value once the probes are in
    const checks = CHECKS.map(r => `<li class="fr" data-r="${r}"><i class="st"></i><span class="fr-l">${esc(T("r_" + r))}</span><span class="fr-v"><span class="bar"></span></span></li>`).join("");
    const faqOf = list => list.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n");
    const langOpts = langs.map(([l, , , nm]) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(nm)}</option>`).join("");
    const home = Object.fromEntries(langs.map(([l, sl]) => [l, path(sl)]));
    // a landing page's lead panel: its verdict, then one row per probe it is about, filled as they answer
    const focusOf = land => {
      if (!land) return "";
      const fr = (id, name) => `<li class="fo-r" data-p="${id}"><span class="fo-n">${esc(name)}</span><span class="fo-x"></span><span class="fo-m"></span></li>`;
      const rows = PROBES.filter(p => p.g === land.group).map(p => fr(p.id, p.name)).join("") +
        // links to other 1ms.dog tools: [meta name, path after the language folder, text], shown once the host announces the tool
        `<li class="fo-all"><a class="btn" href="${path(slug)}">${esc(fill(T("lp_all"), { n: N }))}</a></li>` +
        `<li class="fo-links">${[["home", "chatgpt/", "lat_link"], ["unlock", "ai/", "unlock_link"]]
          .map(([m, at, k]) => `<a class="xl" data-m="${m}" data-at="${at}" target="_blank" rel="noopener" hidden>${esc(T(k))}${EXT}</a>`).join("")}</li>`;
      return `<div class="focus" id="focus" data-focus="${land.id}"><div class="fo-h"><i class="st"></i><b class="fo-t">${esc(T("sniff"))}</b></div>` +
        `<p class="fo-d"><span class="bar"></span></p><ul class="fo-list two">${rows}</ul></div>`;
    };
    // links between the main page and the landing pages, in the footer, then who's WebRTC leak test once the host announces it
    const navOf = land => [null, ...LANDS].filter(x => x !== land).map(x => `<a href="${path(slug) + (x ? x.slug + "/" : "")}">${esc(x ? T("lp_" + x.id).nav : T("name"))}</a>`).join("") +
      `<a class="xl" data-m="who" data-at="webrtc-leak/" target="_blank" rel="noopener" hidden>${esc(T("rtc_nav"))}${EXT}</a>`;
    const page = (head, paths, root, land, v) => tpl
      .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k, inner, close) => open + esc(k === "h1" ? v.h1 : T(k)) + close)
      .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths))).replace("{{rootAttr}}", root ? " data-root" : "")
      .replace("{{prepaint}}", PREPAINT).replace("{{head}}", head).replace("{{css}}", cssName).replace("{{js}}", jsName).replace("{{strings}}", sName)
      .replace("{{homeHref}}", path(slug)).replace("{{langOpts}}", langOpts).replace("{{intro}}", esc(fill(v.intro, { n: N })))
      // the 1ms.dog checkup, which runs this tool with the others, once the host announces it (<meta name="check">)
      .replace("{{checkLink}}", `<a class="xl" data-m="check" data-at="" target="_blank" rel="noopener" hidden>${esc(T("check_link"))}${EXT}</a>`).replace("{{focus}}", focusOf(land))
      .replace("{{groups}}", groupsOf(land && land.group, land && [land.group, "cn", "intl"])).replace("{{checks}}", checks).replace("{{faq}}", faqOf(v.faq)).replace("{{foot}}", esc(T("foot"))).replace("{{nav}}", navOf(land))
      .replace("{{themeLabel}}", esc(T("th_system"))).replaceAll("{{closeLabel}}", esc(T("close")))
      .replace("{{data}}", JSON.stringify({ lang, paths, home, focus: land ? land.id : "", focusGroup: land ? land.group : "" }).replace(/</g, "\\u003c"));

    // the main page, then one landing page per check (LANDS), each with its own words and its own language versions
    let url, og = `${SITE}/og/${lang.toLowerCase()}.png`;
    for (const land of [null, ...LANDS]) {
      const L = land ? T("lp_" + land.id) : null, sub = land ? land.slug + "/" : "";
      const v = land ? { title: L.title, desc: L.desc, kw: L.kw, h1: L.h1, intro: L.intro, faq: [...L.faq, ...T("faq").filter((x, i) => i !== land.skip)] }
        : { title: T("name") + " · " + T("seo_title"), desc: T("seo_desc"), kw: T("seo_kw"), h1: T("h1"), intro: T("intro"), faq: T("faq") };
      const purl = SITE + path(slug) + sub, desc = fill(v.desc, { n: N }), paths = Object.fromEntries(langs.map(([l, sl]) => [l, path(sl) + sub]));
      const alts = langs.map(([l, sl]) => `<link rel="alternate" hreflang="${l}" href="${SITE + path(sl) + sub}">`).join("\n") +
        `\n<link rel="alternate" hreflang="x-default" href="${SITE}/${sub}">`;
      const graph = { "@context": "https://schema.org", "@graph": [
        { "@type": "WebApplication", name: land ? L.h1 : T("name"), url: purl, applicationCategory: "UtilitiesApplication",
          operatingSystem: "Any", browserRequirements: "Requires JavaScript", description: desc, inLanguage: lang, isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
        { "@type": "FAQPage", inLanguage: lang, mainEntity: v.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }] };
      const head = [
        `<title>${esc(v.title)}</title>`,
        `<meta name="description" content="${esc(desc)}">`,
        `<meta name="keywords" content="${esc(v.kw)}">`,
        ...(lang === "zh-CN" ? [`<meta http-equiv="Cache-Control" content="no-transform">`, `<meta http-equiv="Cache-Control" content="no-siteapp">`, `<meta name="applicable-device" content="pc,mobile">`] : []),
        `<meta name="robots" content="index, follow">`,
        `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
        `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
        `<link rel="canonical" href="${purl}">`, alts,
        `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
        `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`, `<meta property="og:title" content="${esc(v.title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
        `<meta property="og:url" content="${purl}">`, `<meta property="og:locale" content="${locale}">`,
        `<meta property="og:image" content="${land ? `${SITE}/og/${lang.toLowerCase()}/${land.slug}.png` : og}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
        `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:image" content="${land ? `${SITE}/og/${lang.toLowerCase()}/${land.slug}.png` : og}">`,
        `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, "\\u003c")}</script>`,
      ].join("\n");
      const html = page(head, paths, !slug, land, v);
      if (/\{\{\w+\}\}/.test(html)) throw new Error("unfilled placeholder in " + path(slug) + sub + ": " + /\{\{\w+\}\}/.exec(html)[0]);
      pages.push({ file: (slug ? slug + "/" : "") + sub + "index.html", url: purl, html, sub });
      if (!land) url = purl;
    }
    const mainV = { h1: T("h1"), intro: T("intro"), faq: T("faq") };
    // A shared result opens /<lang>/r/<verdict>/#r=…: the same page, with a preview card that states the verdict.
    // Not for search engines (noindex, canonical to the page); visitors are sent to their own language's copy.
    for (const vd of VERDICTS) {
      const rp = path(slug) + "r/" + vd + "/", rurl = SITE + rp, rtitle = T("vh_" + vd) + " · " + T("name"), rog = `${SITE}/og/${lang.toLowerCase()}/${vd}.png`;
      const rhead = [
        `<title>${esc(rtitle)}</title>`, `<meta name="description" content="${esc(T("r_desc"))}">`, `<meta name="robots" content="noindex, follow">`,
        `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`, `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
        `<link rel="canonical" href="${url}">`,
        `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
        `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`, `<meta property="og:title" content="${esc(rtitle)}">`,
        `<meta property="og:description" content="${esc(T("r_desc"))}">`, `<meta property="og:url" content="${rurl}">`, `<meta property="og:locale" content="${locale}">`,
        `<meta property="og:image" content="${rog}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
        `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:image" content="${rog}">`,
      ].join("\n");
      const rpaths = Object.fromEntries(langs.map(([l, sl]) => [l, path(sl) + "r/" + vd + "/"]));
      const rhtml = page(rhead, rpaths, true, null, mainV);
      pages.push({ file: rp.slice(1) + "index.html", url: rurl, html: rhtml, shared: true });
    }
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    pages.filter(p => !p.shared).map(p => `  <url>\n    <loc>${p.url}</loc>\n` + langs.map(([l, s]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE + path(s) + p.sub}"/>`).join("\n") +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/${p.sub}"/>\n  </url>`).join("\n") + "\n</urlset>\n";
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;
  const llms = `# Egress

> Free browser tool that shows every exit IP a visitor's traffic uses. ${N} probes are asked at once: sites in
> mainland China, IP lookup services, AI services and popular sites (Cloudflare /cdn-cgi/trace on each one's own domain),
> IPv4-only and IPv6-only hosts, and WebRTC STUN servers over UDP. The answers are grouped by network into exits
> (local line or proxy), and the page reports split routing, per-service routes, WebRTC leaks, the NAT type (cone or symmetric), IPv6 leaks and
> time-zone mismatches. Everything runs client-side; no results are sent to the site.

- Page: ${SITE}/ (also ${langs.slice(1).map(([, s]) => "/" + s + "/").join(", ")})
${LANDS.map(l => `- ${en["lp_" + l.id].nav}: ${SITE}/${l.slug}/ (same tool, this check first)`).join("\n")}
- Probes: ${GROUPS.map(g => `${en["g_" + g]}: ${PROBES.filter(p => p.g === g).map(p => p.self ? new URL(SITE).host : p.host).join(", ")}`).join("; ")}
- Source: https://github.com/yt1988/egresslens
`;

  // The only inline script is the pre-paint snippet, identical on every page: one hash covers the site.
  // connect-src allows any https host: the probes are fetched from the browser.
  const csp = ["default-src 'self'", `script-src 'self' 'sha256-${sha(PREPAINT)}'`, "style-src 'self'",
    "font-src 'self'", "img-src 'self' data:", "connect-src 'self' https:", "manifest-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  const headers = `# Generated by scripts/build.mjs
/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
/assets/*
  Cache-Control: public, max-age=604800
/assets/app.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/l.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/share/*
  ! Cache-Control
  Cache-Control: public, max-age=0, must-revalidate
/flags/*
  Cache-Control: public, max-age=2592000
/og/*
  Cache-Control: public, max-age=604800
/llms.txt
  Access-Control-Allow-Origin: *
  Content-Type: text/plain; charset=utf-8
`;

  Object.assign(files, { ["assets/" + jsName]: js, ["assets/" + cssName]: css, "sitemap.xml": sitemap, "robots.txt": robots, "llms.txt": llms, "_headers": headers });
  for (const p of pages) files[p.file] = p.html;

  const stale = [];
  for (const [name, text] of Object.entries(files)) {
    const url = new URL(name, pub);
    const current = await readFile(url, "utf8").catch(() => null);
    if (current === text) continue;
    if (check) { stale.push(name); continue; }
    await mkdir(new URL(".", url), { recursive: true });
    await writeRetry(url, text);
  }
  // old bundles
  const old = (await readdir(new URL("assets/", pub))).filter(f => /^(app|l\.[a-z-]+)\.[0-9a-f]+\.(js|css)$/.test(f) && !files["assets/" + f]);
  if (check && old.length) stale.push(...old.map(f => f + " (old)"));
  else for (const f of old) await rm(new URL("assets/" + f, pub));
  return { stale, pages: pages.filter(p => !p.shared).length, sizes: { html: Math.max(...pages.map(p => p.html.length)), js: js.length, css: css.length } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const r = await build({ check });
  if (check && r.stale.length) { console.error("out of date (run npm run build):\n  " + r.stale.join("\n  ")); process.exit(1); }
  console.log(`${r.pages} pages · largest HTML ${(r.sizes.html / 1024).toFixed(1)} KB · JS ${(r.sizes.js / 1024).toFixed(1)} KB · CSS ${(r.sizes.css / 1024).toFixed(1)} KB`);
}
