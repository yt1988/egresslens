// The page's pure logic: no DOM, no network. test/lib.test.mjs imports it as a module; scripts/build.mjs drops the
// `export` keywords and inlines it into the page bundle at the /* @lib */ marker in src/app.js.
//
// Exit grouping and the direct/proxy/unknown reading come from the site-wide core in src/egress.js (vendored from
// 1ms.dog; the rules are in its docs/egress-contract.md): this file only adapts its output to what the page shows.
import { groupExits as coreExitGroups, kindOf as coreKind, pathOf as corePath, AI_BLOCKED as coreAIBlocked, tzCountry as coreTzCountry, endpoints as coreEndpoints } from "./egress.js";
import { isRelayIp as relayIp } from "./relay.mjs";

/* ---------- addresses ---------- */
export const fam = x => x.includes(":") ? 6 : 4;
const V4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isIp = x => typeof x === "string" && (V4.test(x) || (/^[0-9a-f:]+$/i.test(x) && x.includes(":") && x.length <= 39));
const v6g = a => {
  const [h, tl = ""] = a.toLowerCase().split("::"), H = h ? h.split(":") : [], T = tl ? tl.split(":") : [];
  return [...H, ...Array(Math.max(0, 8 - H.length - T.length)).fill("0"), ...T].map(g => g.padStart(4, "0"));
};
// CGNAT pools and temporary IPv6 addresses move around inside a /16 or /64: same network
export const netOf = x => fam(x) === 6 ? v6g(x).slice(0, 4).join(":") : x.split(".").slice(0, 2).join(".");
export const sameNet = (a, b) => fam(a) === fam(b) && netOf(a) === netOf(b);
export const asnNum = v => { const m = /(\d+)/.exec(String(v ?? "")); return m ? +m[1] : null; };
// for "hide IPs": keep the network part, so two exits can still be told apart
export const maskIp = x => fam(x) === 6 ? v6g(x).slice(0, 2).map(g => g.replace(/^0+(?=.)/, "")).join(":") + ":…" : x.split(".").slice(0, 2).join(".") + ".•.•";

/* ---------- reading the probes' answers ---------- */
// Each reader gets the response body (JSON parsed when it parses) and returns { ip, geo?, cf? }
// geo = { cc, city, asn, org }; cf = { colo, loc, warp } from a Cloudflare trace
const geo = (cc, city, asn, org) => ({ cc: /^[A-Z]{2}$/.test(cc || "") ? cc : "", city: city || "", asn: asnNum(asn), org: String(org || "").replace(/^AS\d+\s*/, "") });
export const parseTrace = text => Object.fromEntries(String(text).split("\n").map(l => l.split("=")).filter(p => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join("=").trim()]));
export const READERS = {
  text: b => ({ ip: String(b).trim().split(/\s+/)[0] }),
  trace: b => { const t = parseTrace(b); return { ip: t.ip, cf: { colo: t.colo || "", loc: t.loc || "", warp: t.warp || "off" } }; },
  ipip: b => ({ ip: b.data && b.data.ip }),
  iqiyi: b => ({ ip: (/(\d+\.\d+\.\d+\.\d+|[0-9a-f:]{3,})$/i.exec(String(b.t || "")) || [])[1] }),
  ipsb: b => ({ ip: b.ip, geo: geo(b.country_code, b.city, b.asn, b.isp || b.asn_organization) }),
  ipinfo: b => ({ ip: b.ip, geo: geo(b.country, b.city, b.org, b.org) }),
  ipapico: b => ({ ip: b.ip, geo: geo(b.country_code, b.city, b.asn, b.org) }),
  ipwho: b => ({ ip: b.ip, geo: b.success === false ? null : geo(b.country_code, b.city, b.connection && b.connection.asn, b.connection && (b.connection.isp || b.connection.org)) }),
  geojs: b => ({ ip: b.ip, geo: geo(b.country_code, b.city, b.asn, b.organization_name) }),
  ipleak: b => ({ ip: b.ip, geo: geo(b.country_code, b.city_name, b.as_number, b.isp_name) }),
  identme: b => ({ ip: b.ip, geo: geo(b.cc, b.city, b.asn, b.aso) }),
  ipguide: b => { const a = (b.network || {}).autonomous_system || {}; return { ip: b.ip, geo: a.asn ? geo("", (b.location || {}).city, a.asn, a.organization || a.name) : null }; },
  radar: b => ({ ip: b.ip_address, geo: geo(b.country, b.city, b.asn, "") }),
  ipify: b => ({ ip: b.ip }),
  me: b => ({ ip: b.ip, geo: geo(b.country, b.city, b.asn, b.org), cf: { colo: b.colo || "", loc: b.country || "", warp: "off" } }),
  bdc: b => ({ ip: b.ipString }),
  // echo.1ms.dog: { ip, port, proto }; probe.1ms.dog/conn: { ip, mss, … } (or /fp's shape, { ip, tcp: { mss } })
  echo: b => ({ ip: b.ip }),
  conn: b => ({ ip: b.ip, mss: +(b.mss ?? (b.tcp && b.tcp.mss)) || null }),
};
// a reader's result, or null when the answer has no usable address (or the host has one IP version and it is not it)
export function readProbe(probe, body) {
  let r;
  try { r = READERS[probe.read](body); } catch (e) { return null; }
  if (!r || !isIp(r.ip)) return null;
  if (probe.fam && fam(r.ip) !== probe.fam) return null;
  if (r.geo && !r.geo.cc && !r.geo.asn) delete r.geo;
  return r;
}
// ICE candidate line → the server-reflexive address (what the STUN server saw), or null
export const srflxOf = line => { const p = String(line || "").split(" "); return / typ srflx /.test(line) && isIp(p[4]) ? p[4] : null; };
// … with its port: { ip, port }, or null
export const srflxAt = line => { const ip = srflxOf(line); return ip && { ip, port: +String(line).split(" ")[5] }; };

// A TCP MSS (the most data one packet carries) well under Ethernet's 1460 (1440 over IPv6), and under PPPoE's 1452,
// leaves room for a tunnel's own header: a VPN, or an ISP tunnel (DS-Lite) or a mobile network with a small MTU.
export const tunneled = (ip, mss) => !!mss && mss <= (fam(ip) === 6 ? 1380 : 1400);

/* ---------- this site's own endpoints (deploy data) ---------- */
// Where our own probes live is deployment data, not repository content (docs/tool-contract.md §2): the Worker puts
// <meta name="ms-anchors" content="cn=<base>;intl=<base>"> and <meta name="ms-egress"
// content="stun=<host>:<port>,…;echo=<base>[,<base>];ws=…"> into the head from its environment. A self-hosted copy
// has neither, so the probes that need them are left out instead of falling back to anyone else's service.
// The echo bases come in server order: the first is Tokyo (group own), the second the mainland server (owncn). A STUN
// host joins the server whose echo host shares its last two labels (stun.<site> with echo.<site>; a host with itself).
// an anchor is `<base>/conn`, but a deployment may already hand over the full URL: accept both
const anchorUrl = value => {
  try {
    const u = new URL(String(value || ""));
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return "";
    const href = u.href.replace(/\/+$/, "");
    return /\/conn$/.test(href) ? href : href + "/conn";
  } catch (e) { return ""; }
};
const hostOfUrl = value => {
  try { const u = new URL(String(value || "")); return /^https?:$/.test(u.protocol) ? u.hostname : ""; } catch (e) { return ""; }
};
export function ownEndpoints(doc = globalThis.document) {
  const A = coreEndpoints("ms-anchors", doc), E = coreEndpoints("ms-egress", doc);
  const echoes = String(E.echo || "").split(",").map(x => hostOfUrl(x.trim())).filter(Boolean);
  const stuns = [...new Set(String(E.stun || "").split(",").map(x => x.trim().replace(/:\d+$/, ""))
    .filter(h => /^[a-z0-9.-]+$/i.test(h)))];
  const site = h => h.split(".").slice(-2).join(".");
  const stunFor = h => (h ? stuns.find(s => site(s) === site(h)) || "" : "");
  return {
    acn: anchorUrl(A.cn), intl: anchorUrl(A.intl),
    own: { tcp: echoes[0] || "", udp: stunFor(echoes[0]) },
    owncn: { tcp: echoes[1] || "", udp: stunFor(echoes[1]) },
  };
}
// the URL a `need` probe fetches: its host from the deployment, its port from this repository
export function ownUrl(p, E = ownEndpoints()) {
  if (!p.need) return p.url || "";
  if (p.need === "acn") return E.acn;
  if (p.need === "intl") return E.intl;
  const [group, kind] = String(p.need).split(".");
  const host = E[group] && E[group][kind];
  if (!host || !p.port) return "";
  return kind === "tcp" ? `https://${host}:${p.port}/` : `stun:${host}:${p.port}`;
}
// the probes the page can run: those that need nothing injected, and those whose endpoint is there
export const runnableProbes = (probes, E) => probes.filter(p => !p.need || !!ownUrl(p, E));

/* ---------- endpoint tokens (deploy data come from the host) ---------- */
// Our own endpoints — the anchors' /conn and the echo ports — accept the page's short-lived token, which the host puts
// in <meta name="ms-auth"> (1ms.dog tool contract, endpoint authentication). A 401 asks the host for a fresh token once
// and retries once. An endpoint that predates the preflight can only answer a request without the header, so a token
// that never reaches the server falls back to one headerless attempt (the rollout path; a no-op once every server has
// the preflight).
export const authedRead = read => read === "conn" || read === "echo";
export async function fetchWithAuth(fetchImpl, url, opts, { read = "", token = "", renew } = {}) {
  const ours = authedRead(read);
  const send = t => fetchImpl(url, ours && t ? { ...opts, headers: { ...(opts && opts.headers), Authorization: `Bearer ${t}` } } : opts);
  let res;
  try {
    res = await send(ours ? token : "");
  } catch (e) {
    if (!ours || !token) throw e;
    return send("");
  }
  if (ours && res.status === 401) {
    const fresh = renew ? await renew() : "";
    if (fresh) res = await send(fresh);
  }
  return res;
}

/* ---------- exits ---------- */
// Which of this site's own vantage points saw a probe's answer — this site (Cloudflare's view of the connection), our
// Shanghai server, our Tokyo server — or another checkpoint, which is named by itself and not sorted by country
// (tool-contract §0: the visitor's country is never assumed to be China).
export const vantageOf = p =>
  p.self ? "cf" : p.anchor === "cn" || p.g === "owncn" ? "sh" : p.g === "own" ? "tyo" : "other";

// Regions where neither OpenAI (ChatGPT) nor Anthropic (Claude) offers its service, and the time zone → country
// table, both from the shared core (one table for the whole site).
export const AI_BLOCKED = coreAIBlocked;
export const tzCountry = coreTzCountry;
// geo for an address: its own, or that of an address on the same network
export function geoOf(geo, ip) {
  if (geo[ip]) return geo[ip];
  const y = Object.keys(geo).find(x => sameNet(x, ip));
  return y ? geo[y] : null;
}
// seen: [{ ip, probe }] (probe = its id); geo: ip → { cc, city, asn, org }; groupOf: probe id → group; warp: trace's warp;
// anchors: { cn, intl } the address each anchor probe saw.
//
// The grouping and the kind are the shared core's (src/egress.js): one exit per ASN when a lookup knows it, else per
// /16 (IPv4) or /64 (IPv6); its kind is direct, proxy or unknown by who owns that network — never by the anchor it
// matched, since a proxy's own exit follows an anchor too. The page adds every address an exit was seen at, its city
// and country, the probes that saw it, and its path (which anchors it follows).
// Order: direct first, then unknown, then proxies; within a kind by group and how many probes saw it.
export function groupExits(seen, geo, groupOf, warp, anchors = {}) {
  const answers = seen.map(({ ip, probe, stack }) => {
    const g0 = geoOf(geo, ip);
    // `stack` marks a probe whose host has only one IP family: the core compares those with the reference exit of
    // their own family, so a dual-stack line's v4 and v6 addresses are not read as a split route.
    return { id: probe, group: groupOf[probe], ip, org: (g0 && g0.org) || "", asn: (g0 && g0.asn) || null, ...(stack ? { stack: true } : {}) };
  });
  // the core keys an exit by its ASN, else by the address's network; the same key is rebuilt from what the core
  // kept (its first address and ASN), so each answer lands in the exit the core put it in
  const keyOf = x => (x.asn ? "as" + x.asn : netOf(x.ip));
  const E = coreExitGroups(answers).map(c => ({
    key: keyOf(c), ip: c.ip, core: c, ips: [], probes: [], cc: "", city: "", asn: c.asn, org: c.org,
  }));
  const by = new Map(E.map(e => [e.key, e]));
  for (const { ip, probe } of seen) {
    const g0 = geoOf(geo, ip), e = by.get(g0 && g0.asn ? "as" + g0.asn : netOf(ip));
    if (!e) continue;
    if (!e.ips.includes(ip)) e.ips.push(ip);
    if (!e.probes.includes(probe)) e.probes.push(probe);
    if (g0) { e.cc = e.cc || g0.cc || ""; e.city = e.city || g0.city || ""; e.asn = e.asn || g0.asn || null; e.org = e.org || g0.org || ""; }
  }
  for (const e of E) {
    const k = coreKind(e, { warp });
    e.kind = k.kind;                          // direct, proxy, or unknown: no owner information, never read as direct
    e.dc = k.why === "dc" || k.why === "vpn"; // the data-centre or VPN name that made it a proxy
    e.warp = k.why === "warp";
    e.path = corePath(e.core, anchors);       // cn, intl, both, other, or unknown-path
    // iCloud Private Relay leaves from Apple's published ranges (src/relay.mjs): still a proxy, but named for itself
    e.relay = e.ips.some(relayIp);
    const gs = e.probes.map(p => groupOf[p]);
    e.score = (gs.includes("cn") ? 2 : 0) + (gs.includes("udp") ? 1 : 0);
    for (const ip of e.ips) e.v6 = e.v6 || fam(ip) === 6, e.v4 = e.v4 || fam(ip) === 4;
  }
  const rank = e => e.kind === "direct" ? 0 : e.kind === "unknown" ? 1 : 2;
  E.sort((a, b) => rank(a) - rank(b) || b.score - a.score || b.probes.length - a.probes.length || (a.key < b.key ? -1 : 1));
  return labelExits(E);
}
// Direct (D), proxy (P) or can't tell (?): the kind is the shared core's. The label is the letter alone, numbered D1,
// D2… only when there is more than one exit of that kind. A result from a link made before kinds carries data-centre
// and WARP flags only, so it keeps reading those.
export function labelExits(E) {
  for (const e of E) {
    if (!e.kind) e.kind = e.dc || e.warp ? "proxy" : "direct";
    e["v4"] = !!e.v4; e["v6"] = !!e.v6; e.relay = !!e.relay;
  }
  for (const [kind, ch] of [["direct", "D"], ["proxy", "P"], ["unknown", "?"]]) {
    const of = E.filter(e => e.kind === kind);
    of.forEach((e, i) => { e.letter = of.length > 1 ? ch + (i + 1) : ch; });
  }
  return E;
}
// probe id → the labels of the exits it saw
export function exitOfProbe(exits) {
  const m = {};
  for (const e of exits) for (const p of e.probes) (m[p] = m[p] || []).push(e.letter);
  return m;
}

/* ---------- findings ---------- */
// the exit most of a set of probes saw (null when none answered)
function majority(ids, of) {
  const n = {};
  for (const id of ids) if (of[id]) for (const l of of[id]) n[l] = (n[l] || 0) + 1;
  const best = Object.entries(n).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return best ? best[0] : null;
}
const AI_CHECK = ["chatgpt", "openai", "claude", "anthropic"];
// The check table. probes: the PROBES list; exits: groupExits(); cf: probe id → its Cloudflare trace ({ loc } = the
// country that site sees); tzCc: country of the browser's time zone.
// nat: natOf(), or nothing (a shared result from before the NAT row).
// Returns one row per check, always the same eight: { route, except, ai, rtc, port, nat, v6, tz }, each { s, k, v }:
// s the status ("ok" | "warn" | "bad" | "info" | "none"), k the wording's variant, v the values it needs
// (exit labels, probe ids, country codes).
export function findings(probes, exits, cf, tzCc, nat) {
  const of = exitOfProbe(exits), byL = Object.fromEntries(exits.map(e => [e.letter, e]));
  const ids = g => probes.filter(p => p.g === g).map(p => p.id);
  // The two anchor probes sit at destinations no split-tunnel list carries, so each shows the route mainland China
  // and the rest of the world take. A group's majority is the fallback when an anchor did not answer (or an old
  // share link, which has no anchor rows).
  const anchor = k => { const p = probes.find(x => x.anchor === k); return p && of[p.id] ? of[p.id][0] : null; };
  const none = { s: "none", k: "none", v: {} };
  if (!exits.length) return { route: none, except: none, ai: none, rtc: none, port: none, nat: none, v6: none, tz: none };
  const cn = anchor("cn") || majority(ids("cn"), of), abroad = anchor("intl") || majority([...ids("intl"), ...ids("ai"), ...ids("web")], of) || cn;
  const R = {};
  // routing: mainland sites vs. sites abroad
  R.route = cn && cn !== abroad ? { s: "info", k: "split", v: { a: cn, b: abroad } } : { s: "ok", k: "one", v: { a: abroad } };
  // exceptions: any probe abroad (lookup services, AI, sites, single-stack hosts) on another exit than the rest of the
  // world. A single-stack host is only an exception against a reference exit that has an address of its own family: on
  // a dual-stack line the two families are different exits by nature, and the IPv6 row is where that is judged. When
  // every IPv6-only host is in one group they stand as one item, "@v6" (the IPv6 row says why).
  const odd = {}, v6only = probes.filter(p => p.g === "stack" && p.fam === 6).map(p => p.id);
  for (const p of probes) if (["intl", "ai", "web", "stack"].includes(p.g) && of[p.id] && !of[p.id].includes(abroad) && !(p.fam && !byL[abroad]["v" + p.fam])) (odd[of[p.id][0]] = odd[of[p.id][0]] || []).push(p.id);
  const groups = Object.entries(odd).map(([x, list]) => ({ x, list: v6only.every(id => list.includes(id)) ? ["@v6", ...list.filter(id => !v6only.includes(id))] : list }));
  R.except = groups.length ? { s: "info", k: "some", v: { groups } } : { s: "ok", k: "none", v: {} };
  // AI region: the country ChatGPT and Claude see (their own trace), and whether they serve it
  const seen = AI_CHECK.filter(id => cf[id] && /^[A-Z]{2}$/.test(cf[id].loc || ""));
  if (!seen.length) R.ai = none;
  else {
    const bad = seen.filter(id => AI_BLOCKED.has(cf[id].loc));
    const x = majority(ids("ai"), of), e = x && byL[x];
    R.ai = bad.length ? { s: "bad", k: "bad", v: { list: bad, c: cf[bad[0]].loc } }
      : { s: "ok", k: "ok", v: { x, c: cf[seen[0]].loc, dc: !!(e && e.dc) } };
  }
  // WebRTC: UDP sees the direct line while websites abroad (most of them) go through a proxy. A site routed direct
  // seeing the direct line too doesn't make it safe: any page, proxied or not, can read what STUN saw.
  const udp = probes.filter(p => p.read === "stun" && of[p.id]).map(p => p.id), udpL = [...new Set(udp.flatMap(id => of[id]))];
  const leaked = udpL.filter(l => byL[l].kind === "direct"), pxUdp = udpL.filter(l => byL[l].kind === "proxy");
  R.rtc = !udp.length ? { s: "ok", k: "none", v: {} }
    : leaked.length && byL[abroad].kind === "proxy" ? { s: "bad", k: "leak", v: { a: leaked[0] } }
    : pxUdp.length === udpL.length ? { s: "ok", k: "proxy", v: { a: pxUdp[0] } }
    : leaked.length ? { s: "ok", k: "same", v: { a: leaked[0] } }
    : { s: "info", k: "unknown", v: { a: udpL[0] } };
  // Ports and protocols: one server (1ms.dog's own) over TCP and UDP on several ports. The exit most of each saw, and
  // any port on another exit than the rest of its protocol.
  const own = probes.filter(p => p.g === "own"), oTcp = own.filter(p => p.read !== "stun"), oUdp = own.filter(p => p.read === "stun");
  const tcp = majority(oTcp.map(p => p.id), of), udpO = majority(oUdp.map(p => p.id), of), pOdd = {};
  for (const p of own) { const want = p.read === "stun" ? udpO : tcp, l = of[p.id]; if (l && want && !l.includes(want)) (pOdd[l[0]] = pOdd[l[0]] || []).push(p.id); }
  const pv = { groups: Object.entries(pOdd).map(([x, list]) => ({ x, list })) }, pi = pv.groups.length ? "info" : "ok";
  R.port = !tcp && !udpO ? none
    : !udpO ? { s: "info", k: "noudp", v: { a: tcp, ...pv } }
    : !tcp ? { s: "info", k: "udp", v: { b: udpO, ...pv } }
    : tcp === udpO ? { s: pi, k: "same", v: { a: tcp, ...pv } }
    : byL[udpO].kind === "direct" && byL[tcp].kind === "proxy" ? { s: "warn", k: "tcponly", v: { a: tcp, b: udpO, ...pv } }
    : { s: "info", k: "split", v: { a: tcp, b: udpO, ...pv } };
  // NAT type (natOf). STUN sees the UDP exit, so behind a proxy (a TUN-mode client too) it is the proxy's NAT.
  R.nat = !nat ? none : nat.k === "none" ? { s: "info", k: "none", v: {} }
    : { s: nat.k === "cone" ? "ok" : "warn", k: nat.k, v: { ...(nat.multi && { multi: true }), ...(udpL.some(l => byL[l].kind === "proxy") && { px: true }) } };
  // IPv6: the IPv6-only hosts see the direct line while IPv4 goes through a proxy
  const v4 = majority(probes.filter(p => p.g === "stack" && p.fam === 4).map(p => p.id), of);
  const v6 = majority(probes.filter(p => p.g === "stack" && p.fam === 6).map(p => p.id), of);
  R.v6 = !v6 && !exits.some(e => e.v6) ? { s: "info", k: "none", v: {} }
    : v6 && v4 && v6 !== v4 && byL[v6].kind === "direct" && byL[v4].kind === "proxy" ? { s: "bad", k: "leak", v: { a: v6 } }
    : { s: "ok", k: "ok", v: { a: v6 || exits.find(e => e.v6).letter } };
  // time zone against the country sites abroad see (mainland China and Hong Kong/Macau count as one here)
  const cc = byL[abroad].cc;
  R.tz = !tzCc || !cc ? none
    : cc === tzCc || (tzCc === "CN" && ["HK", "MO"].includes(cc)) ? { s: "ok", k: "ok", v: { a: cc } }
    : { s: "warn", k: "bad", v: { a: tzCc, b: cc } };
  return R;
}
// Probe rows that stand out, by probe id: { k: "odd", x, y } a probe on another exit (x) than most of its kind (y:
// mainland sites against mainland sites, everything else against sites abroad), or { k: "leak", x } a STUN server
// that sees the direct line while websites abroad see a proxy.
export function oddProbes(probes, exits) {
  const of = exitOfProbe(exits), byL = Object.fromEntries(exits.map(e => [e.letter, e])), out = {};
  const ids = g => probes.filter(p => p.g === g).map(p => p.id);
  const cn = majority(ids("cn"), of), abroad = majority([...ids("intl"), ...ids("ai"), ...ids("web")], of) || cn;
  if (!abroad) return out;
  for (const p of probes) {
    const l = of[p.id]; if (!l) continue;
    if (p.read === "stun") {
      const loc = l.find(x => byL[x].kind === "direct");
      if (loc && byL[abroad].kind === "proxy") out[p.id] = { k: "leak", x: loc };
      continue;
    }
    const want = p.g === "cn" ? cn : abroad;
    if (want && !l.includes(want)) out[p.id] = { k: "odd", x: l[0], y: want };
  }
  return out;
}
// the rows in the order the page shows them
export const CHECKS = ["route", "except", "ai", "rtc", "port", "nat", "v6", "tz"];

// NAT type, from one peer connection that asks every STUN server at once from one socket. The browser merges
// candidates with the same address and port: one public port for every server is a cone NAT (the mapping doesn't
// depend on the destination; one of NAT1–3, which a browser can't tell apart), a port per server is symmetric (NAT4).
// A server that didn't answer looks just like one merged, so a cone needs two servers that each saw that address on
// their own connection. cands: the shared connection's srflx candidates ({ ip, port }); seen: probe id → addresses
// that server saw on its own; exits: groupExits().
// → { k: "cone" | "sym" | "none" (can't tell), multi: one exit with several public IPv4 addresses (carrier-grade
// NAT or several lines) }
export function natOf(cands, seen, exits) {
  const v4 = cands.filter(c => fam(c.ip) === 4), ips = [...new Set(v4.map(c => c.ip))];
  const ports = ip => new Set(v4.filter(c => c.ip === ip).map(c => c.port)).size;
  const servers = ip => Object.values(seen).filter(l => l.includes(ip)).length;
  const k = ips.some(ip => ports(ip) > 1) ? "sym" : ips.some(ip => servers(ip) >= 2) ? "cone" : "none";
  return { k, multi: exits.some(e => ips.filter(ip => e.ips.includes(ip)).length > 1) };
}

/* ---------- share links ---------- */
// The headline of a result, for the share image and the link's preview card: "leak" (WebRTC or IPv6 skips the proxy),
// "ai" (AI services see a region they don't serve), "split" (sites use different exits), "proxy" (everything through
// one proxy), "direct" (everything on the direct line) or "unknown" (the exits' owners could not be looked up).
// The order is the contract's (docs/egress-contract.md §2). null before there is a result.
export const VERDICTS = ["leak", "ai", "split", "proxy", "direct", "unknown"];
export function verdictOf(finds, exits) {
  if (!finds || !finds.route || finds.route.s === "none") return null;
  if (finds.rtc.s === "bad" || finds.v6.s === "bad") return "leak";
  if (finds.ai.s === "bad") return "ai";
  if (finds.route.k === "split" || finds.except.k === "some") return "split";
  const e = exits.find(x => x.letter === finds.route.v.a);
  return !e || e.kind === "unknown" ? "unknown" : e.kind === "proxy" ? "proxy" : "direct";
}
// A result in a link, without any IP address: per exit its country, city, network and flags; per probe the exits it
// saw (or why it failed), its time and the Cloudflare colo and country it reported. The receiver works the findings
// out again from these, so a shared result reads exactly like the sender's. Version 1:
// #r=1|<unix time base36>|<time-zone country>|<exits>|<probes>[|<nat>]
//   exits:  cc~city~org~asn~flags joined by ","  (flags: d datacenter or VPN, w WARP, i direct, p proxy, u can't
//           tell, r iCloud Private Relay, 4 / 6 has IPv4 / IPv6; a link made before kinds has no i/p/u and is read
//           from d/w)
//   probes: id:<seen>:<ms base36>:<colo>:<loc> joined by ",", where <seen> is the exits' indexes joined by ".", or
//           "x" and why it failed (t timeout, h<status> http, n net, p parse, s stun)
//   nat:    "n", then c cone, s symmetric or u can't tell, then m when one exit has several addresses (absent in links
//           from before the NAT row)
const enc = v => encodeURIComponent(String(v ?? "")).replace(/[~,|:.]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const WHY = { timeout: "t", http: "h", net: "n", parse: "p", stun: "s" }, WHY_OF = Object.fromEntries(Object.entries(WHY).map(([k, v]) => [v, k]));
// rows: probe id → { l: exit labels, ms, cf: { colo, loc } } or { why: { why, n } }; place: include city and network
const NAT = { cone: "c", sym: "s", none: "u" }, NAT_OF = Object.fromEntries(Object.entries(NAT).map(([k, v]) => [v, k]));
const KIND = { direct: "i", proxy: "p", unknown: "u" }, KIND_OF = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));
export function encodeShare({ ts, tz, exits, rows, place, nat }) {
  const ex = exits.map(e => [e.cc, place ? e.city : "", place ? e.org : "", place && e.asn || "",
    (e.dc ? "d" : "") + (e.warp ? "w" : "") + (KIND[e.kind] || "") + (e.relay ? "r" : "") + (e.v4 ? "4" : "") + (e.v6 ? "6" : "")].map(enc).join("~")).join(",");
  const at = Object.fromEntries(exits.map((e, i) => [e.letter, i]));
  const rs = Object.entries(rows).map(([id, r]) => {
    const w = r.why || {}, cf = r.cf || {};
    const seen = r.l && r.l.length ? r.l.map(l => at[l]).join(".") : "x" + (WHY[w.why] || "n") + (w.why === "http" && w.n ? w.n : "");
    return [id, seen, r.ms != null ? Math.round(r.ms).toString(36) : "", /^[A-Z0-9]{3}$/.test(cf.colo || "") ? cf.colo : "", /^[A-Z]{2}$/.test(cf.loc || "") ? cf.loc : ""].join(":");
  }).join(",");
  return "#r=1|" + Math.floor(ts / 1000).toString(36) + "|" + (/^[A-Z]{2}$/.test(tz || "") ? tz : "") + "|" + ex + "|" + rs +
    (nat && NAT[nat.k] ? "|n" + NAT[nat.k] + (nat.multi ? "m" : "") : "");
}
// → { ts, tz, exits, rows, nat } with the exits labeled as on the sender's page, or null when the hash isn't a result.
// ids: the probe ids this page knows (a probe since removed is skipped).
export function parseShare(h, ids) {
  const m = /^#r=1\|([0-9a-z]+)\|([A-Z]{2})?\|([^|]*)\|([^|]*)(?:\|n([csu])(m?))?$/.exec(h || "");
  if (!m) return null;
  const dec = v => { try { return decodeURIComponent(v); } catch (e) { return ""; } };
  const exits = m[3] ? m[3].split(",").map((x, i) => {
    const [cc = "", city = "", org = "", asn = "", f = ""] = x.split("~").map(dec);
    const kind = KIND_OF[["i", "p", "u"].find(k => f.includes(k))] || "";
    return { key: "s" + i, ips: [], probes: [], cc: /^[A-Z]{2}$/.test(cc) ? cc : "", city: city.slice(0, 80), org: org.slice(0, 120), asn: +asn || null,
      dc: f.includes("d"), warp: f.includes("w"), relay: f.includes("r"), ...(kind ? { kind } : {}), v4: f.includes("4"), v6: f.includes("6") };
  }) : [];
  const rows = {};
  for (const p of m[4].split(",")) {
    const [id, seen = "", ms = "", colo = "", loc = ""] = p.split(":");
    if (!ids.includes(id) || !seen) continue;
    const r = rows[id] = { ms: /^[0-9a-z]+$/.test(ms) ? parseInt(ms, 36) : null };
    if (colo || loc) r.cf = { colo: /^[A-Z0-9]{3}$/.test(colo) ? colo : "", loc: /^[A-Z]{2}$/.test(loc) ? loc : "" };
    if (seen[0] === "x") { r.why = { why: WHY_OF[seen[1]] || "net" }; if (+seen.slice(2)) r.why.n = +seen.slice(2); }
    else for (const i of seen.split(".")) if (exits[+i] && !exits[+i].probes.includes(id)) exits[+i].probes.push(id);
  }
  labelExits(exits);
  for (const [id, r] of Object.entries(rows)) if (!r.why) r.l = exits.filter(e => e.probes.includes(id)).map(e => e.letter);
  return { ts: parseInt(m[1], 36) * 1000, tz: m[2] || "", exits, rows, nat: m[5] ? { k: NAT_OF[m[5]], multi: !!m[6] } : null };
}
