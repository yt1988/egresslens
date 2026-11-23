import { test } from "node:test";
import assert from "node:assert/strict";
import { readProbe, srflxOf, groupExits, exitOfProbe, findings, oddProbes, maskIp, parseTrace, sameNet, encodeShare, parseShare, verdictOf, natOf, srflxAt, tunneled, tzCountry } from "../src/lib.mjs";
import { PROBES, GROUPS } from "../src/probes.mjs";

const P = id => PROBES.find(p => p.id === id);
const GROUP_OF = Object.fromEntries(PROBES.map(p => [p.id, p.read === "stun" ? "udp" : p.g]));

test("probes: unique ids, known groups and readers, https or stun", () => {
  const ids = new Set();
  for (const p of PROBES) {
    assert.ok(!ids.has(p.id), "duplicate " + p.id); ids.add(p.id);
    assert.ok(GROUPS.includes(p.g), p.id);
    // this site's own probe asks the page's host, under the name the page gives it
    assert.ok(p.self ? p.url === "/_ms/me" : p.read === "stun" ? p.url.startsWith("stun:") : p.url.startsWith("https://"), p.id);
    assert.ok(p.self || (p.host && p.name), p.id);
  }
});

test("readers", () => {
  // the shell's /_ms/me: Cloudflare's view of this connection
  assert.deepEqual(readProbe(PROBES.find(p => p.self), { ip: "203.0.113.9", family: 4, country: "JP", city: "Tokyo", asn: 16509, org: "Amazon.com, Inc.", colo: "NRT" }),
    { ip: "203.0.113.9", geo: { cc: "JP", city: "Tokyo", asn: 16509, org: "Amazon.com, Inc." }, cf: { colo: "NRT", loc: "JP", warp: "off" } });
  assert.deepEqual(readProbe(P("ipip"), { ret: "ok", data: { ip: "114.254.73.157", location: [] } }), { ip: "114.254.73.157" });
  assert.equal(readProbe(P("iqiyi"), { t: "CNC|BeiJing-114.254.73.157" }).ip, "114.254.73.157");
  assert.equal(readProbe(P("icanhazip"), "2406:da14::1\n").ip, "2406:da14::1");
  const tr = readProbe(P("chatgpt"), "fl=1\nh=chatgpt.com\nip=3.115.99.91\ncolo=NRT\nloc=JP\nwarp=off\n");
  assert.deepEqual(tr, { ip: "3.115.99.91", cf: { colo: "NRT", loc: "JP", warp: "off" } });
  assert.deepEqual(readProbe(P("ipinfo"), { ip: "3.115.99.91", city: "Tokyo", country: "JP", org: "AS16509 Amazon.com, Inc." }).geo,
    { cc: "JP", city: "Tokyo", asn: 16509, org: "Amazon.com, Inc." });
  assert.equal(readProbe(P("ipwho"), { ip: "1.2.3.4", success: true, country_code: "US", connection: { asn: 7922, isp: "Comcast" } }).geo.asn, 7922);
  // a single-version host answering with the other version, or garbage, is no answer
  assert.equal(readProbe(P("ipsb6"), { ip: "1.2.3.4" }), null);
  assert.equal(readProbe(P("icanhazip"), "<html>"), null);
  assert.equal(readProbe(P("ipip"), null), null);
});

test("STUN candidates", () => {
  assert.equal(srflxOf("candidate:1 1 udp 1677729535 114.254.73.157 51234 typ srflx raddr 0.0.0.0 rport 0 generation 0"), "114.254.73.157");
  assert.equal(srflxOf("candidate:1 1 udp 2122260223 abc.local 51234 typ host"), null);
});

test("addresses", () => {
  assert.equal(maskIp("114.254.73.157"), "114.254.•.•");
  assert.equal(maskIp("2408:8207:265b:52d0::1"), "2408:8207:…");
  assert.ok(sameNet("2408:8207:265b:52d0::1", "2408:8207:265b:52d0:aaaa::2"));
  assert.equal(parseTrace("a=1\nb=x=y\n").b, "x=y");
});

// A typical Chinese setup: mainland sites and WebRTC direct on China Unicom, everything abroad through AWS Tokyo,
// and the IPv6-only hosts bypassing the proxy.
const LOCAL4 = "114.254.73.157", LOCAL6 = "2408:8207:265b:52d0::1", PROXY4 = "3.115.99.91", PROXY6 = "2406:da14:3c2:6400::1";
const GEO = { [LOCAL4]: { cc: "CN", city: "Beijing", asn: 4808, org: "China Unicom" }, [PROXY4]: { cc: "JP", city: "Tokyo", asn: 16509, org: "Amazon.com" } };
function scenario() {
  const seen = [], ok = {};
  for (const p of PROBES) {
    const ip = p.g === "cn" ? (p.fam === 6 ? LOCAL6 : LOCAL4) : p.read === "stun" ? LOCAL4 : p.g === "stack" ? (p.fam === 6 ? LOCAL6 : PROXY4) : PROXY6;
    seen.push({ ip, probe: p.id, ...(p.fam ? { stack: true } : {}) }); ok[p.id] = true;
  }
  return { seen, ok };
}

test("exits: grouped by network, direct first, labeled D/P, from the shared core", () => {
  const { seen } = scenario();
  const E = groupExits(seen, { ...GEO, [LOCAL6]: GEO[LOCAL4], [PROXY6]: GEO[PROXY4] }, GROUP_OF, "off");
  assert.equal(E.length, 2);
  assert.deepEqual(E.map(e => [e.letter, e.kind, e.asn]), [["D", "direct", 4808], ["P", "proxy", 16509]]);
  assert.ok(E[0].v4 && E[0].v6 && E[1].v4 && E[1].v6);
  assert.deepEqual(exitOfProbe(E).chatgpt, ["P"]);
  // two proxies are numbered, a single direct line is not
  const E2 = groupExits([...seen, { ip: "47.76.29.28", probe: "cloudflare" }], { ...GEO, [LOCAL6]: GEO[LOCAL4], [PROXY6]: GEO[PROXY4], "47.76.29.28": { cc: "HK", asn: 45102, org: "Alibaba (US) Technology" } }, GROUP_OF, "off");
  assert.deepEqual(E2.map(e => e.letter), ["D", "P1", "P2"]);
});

test("anchors: path and kind are two dimensions; no owner information is unknown, not direct", () => {
  const geo = { "1.1.1.1": { cc: "CN", city: "Beijing", asn: 4808, org: "China Unicom" }, "5.5.5.5": { cc: "JP", city: "Tokyo", asn: 16509, org: "Amazon.com" } };
  const E = groupExits([{ ip: "1.1.1.1", probe: "acn" }, { ip: "1.1.1.1", probe: "ipip" },
    { ip: "5.5.5.5", probe: "aintl" }, { ip: "5.5.5.5", probe: "ipsb" }], geo, GROUP_OF, "off", { cn: "1.1.1.1", intl: "5.5.5.5" });
  // the anchor says which route an exit is on; the kind is who owns it
  assert.deepEqual(E.map(e => [e.letter, e.kind, e.path]), [["D", "direct", "cn"], ["P", "proxy", "intl"]]);
  // Cloudflare's own network is a proxy with or without WARP; WARP on is the reason it gives
  const CF = { cc: "JP", asn: 13335, org: "Cloudflare, Inc." };
  assert.deepEqual(groupExits([{ ip: "8.8.8.8", probe: "ipsb" }], { "8.8.8.8": CF }, GROUP_OF, "off").map(e => [e.kind, e.dc, e.warp]), [["proxy", true, false]]);
  assert.deepEqual(groupExits([{ ip: "8.8.8.8", probe: "ipsb" }], { "8.8.8.8": CF }, GROUP_OF, "on").map(e => [e.kind, e.dc, e.warp]), [["proxy", false, true]]);
  // a VPN brand's exit follows the anchor too, and is still a proxy
  const V = groupExits([{ ip: "9.9.9.9", probe: "aintl" }], { "9.9.9.9": { cc: "SE", asn: 64500, org: "Mullvad VPN AB" } }, GROUP_OF, "off", { intl: "9.9.9.9" });
  assert.deepEqual(V.map(e => [e.letter, e.kind, e.path]), [["P", "proxy", "intl"]]);
  // an exit no lookup knows: "?", unknown, and the verdict says so instead of calling it direct
  const U = groupExits([{ ip: "7.7.7.7", probe: "aintl" }, { ip: "7.7.7.7", probe: "ipsb" }], {}, GROUP_OF, "off", { intl: "7.7.7.7" });
  assert.deepEqual(U.map(e => [e.letter, e.kind]), [["?", "unknown"]]);
  assert.equal(verdictOf(findings(PROBES, U, {}, "", null), U), "unknown");
});

test("anchors: the routing row compares the anchors, not the group's majority", () => {
  const { seen } = scenario();
  // two mainland sites take another proxy while the anchors and the rest stay where they were: still one route each
  const HK = "47.76.29.28";
  const seen2 = seen.map(s => ["iqiyi", "ipifycn"].includes(s.probe) ? { ...s, ip: HK } : s);
  const geo2 = { ...GEO, [LOCAL6]: GEO[LOCAL4], [PROXY6]: GEO[PROXY4], [HK]: { cc: "HK", city: "Hong Kong", asn: 45102, org: "Alibaba (US) Technology" } };
  const exits = groupExits(seen2, geo2, GROUP_OF, "off", { cn: LOCAL4, intl: PROXY6 });
  const F = findings(PROBES, exits, cfAll("JP"), "CN");
  assert.deepEqual(F.route, { s: "info", k: "split", v: { a: "D", b: "P2" } });
  // the IPv6-only hosts are the exceptions; a mainland site on another exit does not change the route the anchor found
  assert.deepEqual(F.except.v.groups, [{ x: "D", list: ["@v6"] }]);
  // without the anchors the row falls back to each group's majority (an old share link): four of the six mainland
  // probes now on the proxy make the majority say "one route", while the anchor still says where mainland China goes
  const many = seen.map(s => ["ipip", "iqiyi", "ipifycn", "dnspod4"].includes(s.probe) ? { ...s, ip: PROXY4 } : s);
  const exits2 = groupExits(many, { ...GEO, [LOCAL6]: GEO[LOCAL4], [PROXY6]: GEO[PROXY4] }, GROUP_OF, "off", { cn: LOCAL4, intl: PROXY6 });
  assert.deepEqual(findings(PROBES, exits2, cfAll("JP"), "CN").route, { s: "info", k: "split", v: { a: "D", b: "P" } });
  assert.deepEqual(findings(PROBES.map(p => ({ ...p, anchor: null })), exits2, cfAll("JP"), "CN").route, { s: "ok", k: "one", v: { a: "P" } });
});

const BOTH = () => ({ ...GEO, [LOCAL6]: GEO[LOCAL4], [PROXY6]: GEO[PROXY4] });
const cfAll = loc => Object.fromEntries(["chatgpt", "openai", "claude", "anthropic"].map(id => [id, { loc, colo: "NRT" }]));

test("checks: split routing, AI region, WebRTC and IPv6 leaks, time zone", () => {
  const { seen } = scenario();
  const F = findings(PROBES, groupExits(seen, BOTH(), GROUP_OF, "off"), cfAll("JP"), "CN");
  assert.deepEqual(Object.keys(F), ["route", "except", "ai", "rtc", "port", "nat", "v6", "tz"]);
  assert.deepEqual(F.route, { s: "info", k: "split", v: { a: "D", b: "P" } });
  // the IPv6-only hosts take the local line: one exception item, consistent with the IPv6 row below
  assert.deepEqual(F.except, { s: "info", k: "some", v: { groups: [{ x: "D", list: ["@v6"] }] } });
  assert.deepEqual(F.ai, { s: "ok", k: "ok", v: { x: "P", c: "JP", dc: true } });
  assert.deepEqual(F.rtc, { s: "bad", k: "leak", v: { a: "D" } });
  assert.deepEqual(F.v6, { s: "bad", k: "leak", v: { a: "D" } });
  assert.deepEqual(F.tz, { s: "warn", k: "bad", v: { a: "CN", b: "JP" } });
  // the same Tokyo server: TCP through the proxy, UDP on the local line
  assert.deepEqual(F.port, { s: "warn", k: "tcponly", v: { a: "P", b: "D", groups: [] } });
});

test("checks: ports and protocols on one server", () => {
  const { seen } = scenario();
  // TCP 8443 alone goes direct; UDP blocked altogether
  const s2 = seen.filter(x => !/^u\d/.test(x.probe)).map(x => x.probe === "t8443" ? { ...x, ip: LOCAL4 } : x);
  const F = findings(PROBES, groupExits(s2, BOTH(), GROUP_OF, "off"), cfAll("JP"), "JP");
  assert.deepEqual(F.port, { s: "info", k: "noudp", v: { a: "P", groups: [{ x: "D", list: ["t8443"] }] } });
  assert.equal(oddProbes(PROBES, groupExits(s2, BOTH(), GROUP_OF, "off")).t8443.k, "odd");
  // nothing from the server at all
  const F2 = findings(PROBES, groupExits(seen.filter(x => !/^[tu]\d/.test(x.probe)), BOTH(), GROUP_OF, "off"), cfAll("JP"), "JP");
  assert.equal(F2.port.s, "none");
});

test("tunnel hint from the MSS", () => {
  assert.ok(tunneled("1.2.3.4", 1380) && tunneled("2001:db8::1", 1360));
  assert.ok(!tunneled("1.2.3.4", 1452) && !tunneled("1.2.3.4", 1460) && !tunneled("2001:db8::1", 1440) && !tunneled("1.2.3.4", null));
  assert.deepEqual(readProbe({ read: "conn" }, { ip: "1.2.3.4", mss: 1380 }), { ip: "1.2.3.4", mss: 1380 });
  assert.equal(readProbe({ read: "conn" }, { ip: "1.2.3.4", tcp: { mss: 1452 } }).mss, 1452);
});

test("checks: AI services that see an unsupported region", () => {
  const { seen } = scenario();
  const cf = { ...cfAll("JP"), claude: { loc: "HK" }, anthropic: { loc: "HK" } };
  const F = findings(PROBES, groupExits(seen, BOTH(), GROUP_OF, "off"), cf, "JP");
  assert.deepEqual(F.ai, { s: "bad", k: "bad", v: { list: ["claude", "anthropic"], c: "HK" } });
  assert.equal(F.tz.s, "ok");
});

test("checks: one exit, a service on its own route, no WebRTC answer", () => {
  const seen = PROBES.filter(p => p.read !== "stun").map(p => ({ ip: p.fam === 6 ? "2001:db8::1" : "1.2.3.4", probe: p.id }));
  const geo = { "1.2.3.4": { cc: "US", city: "Austin", asn: 7922, org: "Comcast" }, "2001:db8::1": { cc: "US", city: "Austin", asn: 7922, org: "Comcast" } };
  let F = findings(PROBES, groupExits(seen, geo, GROUP_OF, "off"), cfAll("US"), "US");
  assert.deepEqual(F.route, { s: "ok", k: "one", v: { a: "D" } });
  assert.equal(F.rtc.k, "none");
  assert.deepEqual(F.v6, { s: "ok", k: "ok", v: { a: "D" } });
  // ChatGPT and Claude through a US server, the rest local
  const seen2 = seen.map(s => ["chatgpt", "claude"].includes(s.probe) ? { ip: "5.6.7.8", probe: s.probe } : s);
  F = findings(PROBES, groupExits(seen2, { ...geo, "5.6.7.8": { cc: "US", city: "Ashburn", asn: 14618, org: "Amazon.com" } }, GROUP_OF, "off"), cfAll("US"), "US");
  assert.deepEqual(F.except, { s: "info", k: "some", v: { groups: [{ x: "P", list: ["chatgpt", "claude"] }] } });
  // no exits at all: every row is empty
  assert.ok(Object.values(findings(PROBES, [], {}, "US")).every(r => r.s === "none"));
});

test("exceptions: a single-stack probe needs a reference exit of its own family", () => {
  // every dual-stack probe abroad on a v4-only proxy; the IPv6-only hosts on a direct v6 exit. The two families are
  // different exits, but the abroad exit has no IPv6 address to compare them with, so they are not an exception:
  // the IPv6 row is where that is judged.
  const geo = { "1.2.3.4": { cc: "JP", asn: 16509, org: "Amazon.com" }, "2001:db8::1": { cc: "CN", asn: 4808, org: "China Unicom" } };
  const seen = PROBES.filter(p => p.read !== "stun").map(p => ({ ip: p.fam === 6 ? "2001:db8::1" : "1.2.3.4", probe: p.id, ...(p.fam ? { stack: true } : {}) }));
  const F = findings(PROBES, groupExits(seen, geo, GROUP_OF, "off"), cfAll("JP"), "CN");
  assert.deepEqual(F.except, { s: "ok", k: "none", v: {} });
  assert.equal(F.v6.s, "bad");
});

test("time zones: the site's one table, with the zone it still lacks", () => {
  assert.equal(tzCountry("Asia/Shanghai"), "CN");
  assert.equal(tzCountry("Europe/Brussels"), "BE");
  assert.equal(tzCountry("Asia/Tehran"), null);   // src/app.js keeps this one until the shared table has it
});

test("odd rows: probes on another exit than their kind, and a WebRTC leak", () => {
  const { seen } = scenario();
  const O = oddProbes(PROBES, groupExits(seen, BOTH(), GROUP_OF, "off"));
  // the IPv6-only hosts take the local line while sites abroad take the proxy; STUN sees the local line too
  assert.deepEqual(O.ipsb6, { k: "odd", x: "D", y: "P" });
  assert.deepEqual(O["stun-cf"], { k: "leak", x: "D" });
  assert.equal(O.chatgpt, undefined);
  assert.equal(O.ipip, undefined);
});

test("share link: no addresses, and the receiver reads the same findings", () => {
  const { seen } = scenario();
  const exits = groupExits(seen, BOTH(), GROUP_OF, "off"), of = exitOfProbe(exits), cf = cfAll("JP");
  const rows = Object.fromEntries(PROBES.map(p => [p.id, of[p.id] ? { l: of[p.id], ms: 123.4, cf: cf[p.id] } : { why: { why: "http", n: 403 } }]));
  const nat = { k: "sym", multi: true }, F = findings(PROBES, exits, cf, "CN", nat);
  assert.equal(verdictOf(F, exits), "leak");
  for (const place of [false, true]) {
    const h = encodeShare({ ts: 1.7e12, tz: "CN", exits, rows, place, nat });
    assert.match(h, /^#r=1\|/);
    for (const ip of seen.map(s => s.ip)) assert.ok(!h.includes(encodeURIComponent(ip).replace(/[.:]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())) && !h.includes(ip), "address in link: " + ip);
    assert.equal(h.includes("Tokyo"), place);
    const R = parseShare(h, PROBES.map(p => p.id));
    assert.equal(R.tz, "CN");
    assert.deepEqual(R.exits.map(e => [e.letter, e.kind, e.cc]), exits.map(e => [e.letter, e.kind, e.cc]));
    const cf2 = Object.fromEntries(Object.entries(R.rows).filter(([, r]) => r.cf).map(([id, r]) => [id, r.cf]));
    assert.deepEqual(findings(PROBES, R.exits, cf2, R.tz, R.nat), F);
    // a link from before the NAT row: the row has nothing to say
    const old = parseShare(h.replace(/\|n[csu]m?$/, ""), PROBES.map(p => p.id));
    assert.equal(old.nat, null);
    assert.equal(findings(PROBES, old.exits, cf2, old.tz, old.nat).nat.s, "none");
    assert.deepEqual(oddProbes(PROBES, R.exits), oddProbes(PROBES, exits));
  }
  assert.equal(parseShare("#r=2|x", []), null);
  assert.equal(parseShare("#nope", []), null);
});

test("share link: an exit's kind travels with it, and links from before kinds still open", () => {
  const ids = PROBES.map(p => p.id);
  const P4 = groupExits([{ ip: "7.7.7.7", probe: "ipsb" }], { "7.7.7.7": { cc: "JP", asn: 16509, org: "Amazon.com" } }, GROUP_OF, "off");
  const hp = encodeShare({ ts: 1.7e12, tz: "JP", exits: P4, rows: { ipsb: { l: ["P"], ms: 10 } }, place: false });
  assert.deepEqual(parseShare(hp, ids).exits.map(e => [e.letter, e.kind]), [["P", "proxy"]]);
  // an exit with no owner information: "?" in the page and "unknown" in the verdict, never direct
  const U = groupExits([{ ip: "7.7.7.7", probe: "ipsb" }], {}, GROUP_OF, "off");
  const hu = encodeShare({ ts: 1.7e12, tz: "", exits: U, rows: {}, place: false });
  assert.deepEqual(parseShare(hu, ids).exits.map(e => [e.letter, e.kind]), [["?", "unknown"]]);
  assert.equal(parseShare(hu.replace("u4", "4"), ids).exits[0].kind, "direct", "a link from before kinds: the old reading");
});

test("WebRTC: a leak even when one site abroad is routed direct", () => {
  const { seen } = scenario();
  // www.cloudflare.com goes direct (sees the local line); the rest abroad through the proxy; STUN sees the local line
  const seen2 = seen.map(s => s.probe === "cloudflare" ? { ip: LOCAL4, probe: s.probe } : s);
  const exits = groupExits(seen2, BOTH(), GROUP_OF, "off");
  const F = findings(PROBES, exits, cfAll("JP"), "CN");
  assert.deepEqual(F.rtc, { s: "bad", k: "leak", v: { a: "D" } });
  assert.equal(oddProbes(PROBES, exits)["stun-cf"].k, "leak");
});

test("NAT type: one port for every server is a cone, a port per server symmetric, too few answers can't tell", () => {
  const { seen } = scenario();
  const exits = groupExits(seen, BOTH(), GROUP_OF, "off");
  assert.deepEqual(srflxAt("candidate:1 1 udp 1677729535 114.254.73.157 60797 typ srflx raddr 0.0.0.0 rport 0 generation 0"), { ip: LOCAL4, port: 60797 });
  assert.equal(srflxAt("candidate:1 1 udp 2122260223 abc.local 60797 typ host generation 0"), null);
  const two = { "stun-mi": [LOCAL4], "stun-bili": [LOCAL4], "stun-google": [LOCAL6] };
  assert.deepEqual(natOf([{ ip: LOCAL4, port: 1000 }, { ip: LOCAL6, port: 2000 }], two, exits), { k: "cone", multi: false });
  assert.deepEqual(natOf([{ ip: LOCAL4, port: 1000 }, { ip: LOCAL4, port: 1001 }], two, exits), { k: "sym", multi: false });
  // one server answered on its own: a single candidate may be the only answer, not a merge
  assert.equal(natOf([{ ip: LOCAL4, port: 1000 }], { "stun-mi": [LOCAL4], "stun-google": [LOCAL6] }, exits).k, "none");
  assert.equal(natOf([], two, exits).k, "none");
  // two addresses on the local line: carrier-grade NAT or several lines
  assert.equal(natOf([{ ip: LOCAL4, port: 1000 }, { ip: "114.254.73.158", port: 1000 }], two, [{ ...exits[0], ips: [LOCAL4, "114.254.73.158"] }]).multi, true);
  // the row: a cone is fine, symmetric a warning, and behind a proxy the NAT is the proxy's
  const F = findings(PROBES, exits, {}, "CN", { k: "cone", multi: false });
  assert.equal(F.nat.s, "ok");
  assert.equal(findings(PROBES, exits, {}, "CN", { k: "sym", multi: false }).nat.s, "warn");
  assert.deepEqual(findings(PROBES, exits, {}, "CN", { k: "none", multi: false }).nat, { s: "info", k: "none", v: {} });
});
