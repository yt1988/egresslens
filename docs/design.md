# Design notes

Why EgressLens measures the way it does, and what was found by testing. The code comments say how; this says why.

## Ask many destinations, then group

A rule-based proxy (Clash, Surge, Shadowrocket, sing-box…) chooses the route per destination: mainland sites direct,
AI services through one server, the rest through another. A single "what is my IP" check sees one route. So the page
asks about 60 destinations at once and groups the addresses they report into exits.

- **One exit per network**, keyed by ASN when a lookup knows it, else by the address prefix (/16 for IPv4, /64 for
  IPv6). An ISP's IPv4 and IPv6 addresses are then one exit, not two.
- **Direct (D), proxy (P) or can't tell (?)** comes from the network's owner: a cloud or hosting company, a VPN brand
  (regexes over the org name), an ASN on the data-centre list, or Cloudflare WARP is a proxy; a network whose owner no
  lookup knows is unknown, never read as direct. A residential proxy, or a VPN on an ISP's network, can't be told
  apart this way, and the FAQ says so. The rules — with the data-centre, VPN, time-zone and AI-region tables — live in
  the site-wide core `src/egress.js` (vendored from 1ms.dog, copied verbatim; `docs/egress-contract.md` there has
  them). Do not add a regex here: change the core, then re-copy it.
- **An anchor says which route, not what kind.** Two probes sit at destinations no split-tunnel list names, one in
  mainland China (`probe.dog.1msapp.com:9443/conn`) and one in Tokyo (`probe.1ms.dog/conn`). What they see is the route
  the visitor's rules did not choose, so the two of them tell a split route from a single one, and each exit keeps
  which anchor it follows (`path`). A proxy's exit follows an anchor too, so a matching anchor never makes an exit
  direct: the kind is who owns it.
- **The reference exit** for "abroad" is the abroad anchor; when it did not answer, the majority of IP lookup
  services, AI services and popular sites. Mainland sites have the same pair (their anchor, else their majority). A
  probe on another exit than its kind is an exception.

## What each kind of probe reads

- **AI services and popular sites**: Cloudflare's `/cdn-cgi/trace` on the site's own domain. It returns the address
  that connected and the country Cloudflare places it in, with `Access-Control-Allow-Origin: *`. The browser connects
  through whatever route the rules pick for that domain, so the answer is exactly what chatgpt.com or claude.ai sees.
- **Single-stack hosts** (only A or only AAAA) show each IP version's exit even when the browser prefers the other.
  An IPv6-only host on the local line while IPv4 goes through the proxy is an IPv6 leak.
- **This site's own address**: the 1ms.dog shell's `/_ms/me` (what Cloudflare saw of this connection). A self-hosted
  page has no shell: on 404 the probe falls back to the host's `/cdn-cgi/trace`.
- **STUN over WebRTC**: the only UDP a page can send. Many proxies carry only TCP, so a STUN server can see the local
  line while websites see the proxy, and any page can read that answer without a prompt.

## STUN and the NAT type

- **One peer connection per STUN server** for the leak check, so each server's answer is its own. With several
  servers on one connection the browser merges identical candidates and the attribution is lost.
- **One shared peer connection, every server at once**, for the NAT type: one local socket, so the candidates show
  whether the public port depends on the destination. One public port for every server is a cone NAT (one of NAT1–3:
  a browser can't tell those apart); a port per server is symmetric (NAT4).
- A server that didn't answer looks the same as one whose candidate was merged, so "cone" needs two servers that each
  saw that address on their own connection. Otherwise the row says it can't tell.
- Google's STUN answers from mainland China only over IPv6, so two STUN servers that answer there over IPv4 were
  added (Bilibili, Mango TV): the NAT type needs two over IPv4.
- Behind a proxy (a TUN-mode client too) STUN sees the proxy's UDP exit, so the NAT measured is the proxy's. The row
  says so when the UDP exit is a proxy.

## One server of its own: fix the destination, vary port and protocol

Comparing destinations can't tell a rule by domain from a rule by port or protocol. The echo server (`server/`) is
one address the page asks over TCP on six ports and over UDP on four. The destination stays the same, so a different
exit can only come from the proxy's rules: TCP proxied while UDP goes direct, one port on its own route, UDP blocked.
Tested on a real setup (2026-11): the rules sent that server's TCP 443 through the proxy while TCP 4433–10443 and
every UDP port went direct, which no other probe could have shown.

- **HTTPS, not plain HTTP**, on every TCP port: an https page can't read an http answer (mixed content). Ports
  browsers refuse (22, 25, 110, 143, 465, 587, 993, 995, 6000, 10080 and the rest of Chrome's list) are unusable.
- **STUN, not TURN**: a Binding request already returns the mapped address, which is all the page needs. TURN would
  relay traffic (bandwidth on a metered server), needs credentials handed to every page, and adds nothing to the
  measurement.
- **No amplification**: the server answers only a well-formed Binding request, and the answer (32 bytes for IPv4, 44
  for IPv6) is at most a little over twice the smallest request.
- **Ports**: 3478 (the STUN default), 19302 (Google's), 51820 (WireGuard's, which some rules single out) and one high
  port; 4433–10443 for TCP. 53 and 443 are left alone: a DNS server and other probes may want them.
- The new STUN ports count for the WebRTC leak and the NAT type too: same IP on another port is the cleanest test of a
  port-dependent mapping.

## The tunnel hint from the MSS

The TCP 443 probe reads the MSS (the most data one packet carries) of its own connection, as the server saw it in the
SYN. Ethernet gives 1460 (1440 over IPv6), PPPoE 1452; a tunnel's own header lowers it: WireGuard's usual MTU of 1420
gives 1380. So at 1400 or less (1380 over IPv6) the exit card says "maybe a tunnel". It is worded as a hint because an
ISP tunnel (DS-Lite) and some mobile networks lower it too. The other direction means nothing: a cloud host with jumbo
frames sends 8941 (seen from an AWS Tokyo exit).

## Embedded in a checkup

With `?embed=checkup`, and only when the host's `<meta name="check">` names the referrer's origin, the page hides
everything but the run, starts at once and posts progress, size and result to that origin alone. An ad blocker drops
the probes in one batch, so the page gives up early instead of waiting out every timeout: 12 failures and no success,
or no success after 15 seconds. This site's own probe doesn't count, since blockers leave it alone. `ResizeObserver`
doesn't fire in an iframe that isn't shown, so the size is also posted on each progress step.

## Share links

The result goes after the `#` (`#r=1|…`): browsers never send it to a server. The path is `/<lang>/r/<verdict>/`, so
a link preview can state the verdict without the result. The receiver works the findings out again from the per-probe
exits, so a shared result reads exactly like the sender's. Probes added later are simply absent from older links.

## Wording

- Country names in the strings stand alone as values ("Browser: China, exit: Japan"), never inside a sentence:
  Russian, French and Portuguese would need a case or an article the code can't supply ("выход в Япония", "en Japon").
- Russian and German are the longest; links and labels must wrap on a phone, or a single `nowrap` link widens the page.
