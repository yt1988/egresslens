// Every probe the page runs. A rule-based proxy or VPN picks the route by destination, so each probe sits at a
// different kind of destination and reports the address it sees. Every HTTPS probe here answers CORS for any origin
// (checked by `npm run verify`), so a static page can read it.
//
// id    stable id (row ids, share text)
// g     group, see GROUPS
// name  shown name; host: the domain shown under it — never for our own probes (see nameKey)
// nameKey  a string key shown instead of name, translated; its host is not shown either
// url   what the browser fetches; for read "stun" a STUN server
// read  how to read the answer (READERS in src/lib.mjs)
// fam   4 or 6 when the host only has that IP version
// anchor "cn" or "intl": this probe is one of the two route anchors (see below)
// self  this page's own host: the 1ms.dog shell's /_ms/me (Cloudflare's view of this connection: the fastest answer,
//       and no third party), or this host's /cdn-cgi/trace where there is no shell. Its name and host come from the
//       page (string self_name, the site's address).

// This site's own server in mainland China, by port and protocol, like the Tokyo one. The machine is being set up
// (2026-11-24): flip this on once every port answers from outside, so a visitor never sees rows for ports that are not
// there yet. The hostname is never shown on the page, like the rest of this site's own probes.
const CN_PORTS_READY = false;
const CN_HOST = "echo.dog.1msapp.com";
const CN_PORTS = [...[4433, 8080, 8443, 10443, 2053].map(n => ({ id: "cnt" + n, g: "owncn", name: "CN TCP " + n, host: CN_HOST, url: `https://${CN_HOST}:${n}/`, read: "echo" })),
  ...[3478, 19302, 51820, 40000].map(n => ({ id: "cnu" + n, g: "owncn", name: "CN UDP " + n, host: CN_HOST, url: `stun:${CN_HOST}:${n}`, read: "stun" }))];

// group id → whether its probes stand for "abroad" when the page compares routes
export const GROUPS = ["cn", "intl", "ai", "web", "stack", "udp", "own", ...(CN_PORTS_READY ? ["owncn"] : [])];
// The two anchors (1ms.dog's shared exit rules, docs/egress-contract.md §1): one destination in mainland China and one
// abroad, neither in any split-tunnel list, on this site's own machines. What they see is the route no rule should
// have changed, which is what tells a split route from an only-one-route; the kind (direct or proxy) still comes from
// who owns the exit. `anchor: "cn" | "intl"` marks them. Their hostnames are never shown on the page: a rule list that
// named them would route around the anchor, and the page is the easiest place to scrape one from.

const trace = (id, g, name, host) => ({ id, g, name, host, url: `https://${host}/cdn-cgi/trace`, read: "trace" });

export const PROBES = [
  // sites in mainland China: a rule-based proxy usually sends these direct
  { id: "ipip", g: "cn", name: "IPIP.NET", host: "myip.ipip.net", url: "https://myip.ipip.net/json", read: "ipip" },
  { id: "iqiyi", g: "cn", name: "iQIYI", host: "data.video.iqiyi.com", url: "https://data.video.iqiyi.com/v.f4v", read: "iqiyi" },
  { id: "ipifycn", g: "cn", name: "ipify.cn", host: "api.ipify.cn", url: "https://api.ipify.cn", read: "text" },
  { id: "dnspod4", g: "cn", name: "DNSPod", host: "ipv4.ddnspod.com", url: "https://ipv4.ddnspod.com", read: "text", fam: 4 },
  { id: "dnspod6", g: "cn", name: "DNSPod", host: "ipv6.ddnspod.com", url: "https://ipv6.ddnspod.com", read: "text", fam: 6 },
  // the route anchor in mainland China: shown by its role, never by its host
  { id: "acn", g: "cn", nameKey: "name_anchor_cn", host: "probe.dog.1msapp.com", url: "https://probe.dog.1msapp.com:9443/conn", read: "conn", anchor: "cn" },

  // IP lookup services abroad, this site first
  { id: "self", g: "intl", name: "", host: "", url: "/_ms/me", read: "me", self: 1 },
  { id: "ipsb", g: "intl", name: "IP.SB", host: "api.ip.sb", url: "https://api.ip.sb/geoip", read: "ipsb" },
  { id: "ipinfo", g: "intl", name: "ipinfo.io", host: "ipinfo.io", url: "https://ipinfo.io/json", read: "ipinfo" },
  { id: "ipapico", g: "intl", name: "ipapi.co", host: "ipapi.co", url: "https://ipapi.co/json/", read: "ipapico" },
  { id: "ipwho", g: "intl", name: "ipwho.is", host: "ipwho.is", url: "https://ipwho.is/", read: "ipwho" },
  { id: "geojs", g: "intl", name: "GeoJS", host: "get.geojs.io", url: "https://get.geojs.io/v1/ip/geo.json", read: "geojs" },
  { id: "ipleak", g: "intl", name: "ipleak.net", host: "ipleak.net", url: "https://ipleak.net/json/", read: "ipleak" },
  { id: "identme", g: "intl", name: "ident.me", host: "ident.me", url: "https://ident.me/json", read: "identme" },
  { id: "ipguide", g: "intl", name: "ip.guide", host: "ip.guide", url: "https://ip.guide/", read: "ipguide" },
  { id: "icanhazip", g: "intl", name: "icanhazip", host: "icanhazip.com", url: "https://icanhazip.com", read: "text" },
  { id: "bdc", g: "intl", name: "BigDataCloud", host: "api.bigdatacloud.net", url: "https://api.bigdatacloud.net/data/client-ip", read: "bdc" },

  // AI services: Cloudflare's trace on the service's own domain shows the address that service sees
  trace("chatgpt", "ai", "ChatGPT", "chatgpt.com"),
  trace("openai", "ai", "OpenAI", "openai.com"),
  trace("sora", "ai", "Sora", "sora.com"),
  trace("claude", "ai", "Claude", "claude.ai"),
  trace("anthropic", "ai", "Anthropic", "anthropic.com"),
  trace("grok", "ai", "Grok", "grok.com"),
  trace("perplexity", "ai", "Perplexity", "perplexity.ai"),
  trace("copilot", "ai", "Copilot", "copilot.microsoft.com"),
  trace("mistral", "ai", "Mistral", "mistral.ai"),
  trace("poe", "ai", "Poe", "poe.com"),
  trace("characterai", "ai", "Character.AI", "character.ai"),
  trace("deepl", "ai", "DeepL", "deepl.com"),

  // popular sites, same method
  trace("cloudflare", "web", "Cloudflare", "www.cloudflare.com"),
  trace("one", "web", "1.1.1.1", "one.one.one.one"),
  trace("gitlab", "web", "GitLab", "gitlab.com"),
  trace("npm", "web", "npm", "registry.npmjs.org"),
  trace("notion", "web", "Notion", "notion.so"),
  trace("linear", "web", "Linear", "linear.app"),
  trace("zoom", "web", "Zoom", "zoom.us"),
  trace("medium", "web", "Medium", "medium.com"),
  trace("coinbase", "web", "Coinbase", "coinbase.com"),
  trace("crunchyroll", "web", "Crunchyroll", "crunchyroll.com"),
  trace("patreon", "web", "Patreon", "patreon.com"),
  trace("shopify", "web", "Shopify", "shopify.com"),

  // hosts with only one IP version: shows each version's exit, even when the browser prefers the other
  { id: "ipsb4", g: "stack", name: "IP.SB", host: "api-ipv4.ip.sb", url: "https://api-ipv4.ip.sb/geoip", read: "ipsb", fam: 4 },
  { id: "ipsb6", g: "stack", name: "IP.SB", host: "api-ipv6.ip.sb", url: "https://api-ipv6.ip.sb/geoip", read: "ipsb", fam: 6 },
  { id: "radar4", g: "stack", name: "Cloudflare Radar", host: "ipv4-check-perf.radar.cloudflare.com", url: "https://ipv4-check-perf.radar.cloudflare.com/", read: "radar", fam: 4 },
  { id: "radar6", g: "stack", name: "Cloudflare Radar", host: "ipv6-check-perf.radar.cloudflare.com", url: "https://ipv6-check-perf.radar.cloudflare.com/", read: "radar", fam: 6 },
  { id: "ipify4", g: "stack", name: "ipify", host: "api4.ipify.org", url: "https://api4.ipify.org/?format=json", read: "ipify", fam: 4 },
  { id: "ipify6", g: "stack", name: "ipify", host: "api6.ipify.org", url: "https://api6.ipify.org/?format=json", read: "ipify", fam: 6 },
  { id: "icanhaz4", g: "stack", name: "icanhazip", host: "ipv4.icanhazip.com", url: "https://ipv4.icanhazip.com", read: "text", fam: 4 },
  { id: "icanhaz6", g: "stack", name: "icanhazip", host: "ipv6.icanhazip.com", url: "https://ipv6.icanhazip.com", read: "text", fam: 6 },

  // WebRTC over UDP: many proxies only carry TCP, so a STUN server can see a different address than websites do
  { id: "stun-cf", g: "udp", name: "Cloudflare", host: "stun.cloudflare.com", url: "stun:stun.cloudflare.com:3478", read: "stun" },
  { id: "stun-google", g: "udp", name: "Google", host: "stun.l.google.com", url: "stun:stun.l.google.com:19302", read: "stun" },
  { id: "stun-twilio", g: "udp", name: "Twilio", host: "global.stun.twilio.com", url: "stun:global.stun.twilio.com:3478", read: "stun" },
  { id: "stun-mi", g: "udp", name: "Xiaomi", host: "stun.miwifi.com", url: "stun:stun.miwifi.com:3478", read: "stun" },
  // two more that answer from mainland China, where Google's answers only over IPv6: the NAT type needs two over IPv4
  { id: "stun-bili", g: "udp", name: "Bilibili", host: "stun.chat.bilibili.com", url: "stun:stun.chat.bilibili.com:3478", read: "stun" },
  { id: "stun-hitv", g: "udp", name: "Mango TV", host: "stun.hitv.com", url: "stun:stun.hitv.com:3478", read: "stun" },

  // this site's own server in Tokyo, over TCP on several ports and over UDP (STUN) on several: the destination stays
  // the same, so another exit comes from rules by port or protocol. 443 is who.1ms.dog's probe (/conn, which also
  // reads the connection's MSS) and is the route anchor abroad, so the page asks it once; the rest is this repo's
  // server/ (echo.1ms.dog, stun.1ms.dog).
  { id: "t443", g: "own", name: "TCP 443", host: "probe.1ms.dog", url: "https://probe.1ms.dog/conn", read: "conn", anchor: "intl" },
  ...[4433, 8080, 8443, 9443, 10443].map(n => ({ id: "t" + n, g: "own", name: "TCP " + n, host: "echo.1ms.dog", url: `https://echo.1ms.dog:${n}/`, read: "echo" })),
  ...[3478, 19302, 51820, 40000].map(n => ({ id: "u" + n, g: "own", name: "UDP " + n, host: "stun.1ms.dog", url: `stun:stun.1ms.dog:${n}`, read: "stun" })),

  // this site's server in mainland China: the cross-border leg to it, not a test of domestic speed (see the group note)
  ...(CN_PORTS_READY ? CN_PORTS : []),
];
