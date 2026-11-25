# AGENTS.md

For anyone, person or AI agent, who picks up this repository. The user-facing description is in README.md; why the
page measures the way it does, and what was tested, is in docs/design.md. 1ms.dog's operating notes (accounts, who
maintains what, the shared server) are in its private repository, 1ms-shell.

## What this is

**EgressLens** (出口照妖镜, egress.1ms.dog): a static page that finds every exit IP the visitor's traffic takes. A
rule-based proxy or VPN picks a route per destination, so the page asks about 60 places at once (sites in mainland
China and abroad, IP lookup services, AI services through their own Cloudflare trace, single-stack IPv4/IPv6 hosts,
STUN servers over WebRTC, and one server of its own over several TCP and UDP ports) and groups the answers into exits.
From them it reports split routing, services on their own route, the AI region, WebRTC and IPv6 leaks, rules by port
or protocol, the NAT type and a time zone that doesn't match. 10 languages, a landing page for what ChatGPT and
Claude see, shareable results that carry no address.

Two parts:

| Part | Where | Runs on |
| --- | --- | --- |
| The page | `src/` (probes, logic, browser code, template, strings), built into `public/` | any static host; Cloudflare Workers static assets here (`wrangler.toml`, no script) |
| The echo server | `server/` (Go): STUN on UDP ports, HTTPS echo on TCP ports, a WebSocket echo | a Linux server of its own |

Rules the code keeps, and any change must too:

- Nothing about a visitor is logged or stored. The page is static files; the browser asks each probe directly. The
  echo server sends back the address it sees and forgets it; it writes errors only.
- A shared link carries no IP address: per exit its country (and, if the visitor ticks the box, city and network),
  per probe which exit it saw. The result sits after the `#`, which browsers never send to a server.
- Every string is in all 10 languages (`src/i18n/`, `en.mjs` is the reference and the fallback); placeholders such
  as `{a}` must be the same in every language.
- `public/` is generated and committed: run `npm run build` after any change in `src/` or `scripts/`.
- The addresses of this site's own probes are deploy data, never repository content (`docs/tool-contract.md` §2 in
  1ms.dog). The hosting site writes them into each HTML page as `<meta name="ms-anchors">` / `<meta name="ms-egress">`
  (on 1ms.dog the shell injects them into every tool page); the repository keeps the parser, the ports and
  placeholders. Without the metas the page leaves those probes out and asks only the public services — no third-party
  fallback.
- No prompt for a permission, ever. WebRTC is used only to gather candidates; no media, no peer.

## Run it locally

Needs Node 20 or later.

```bash
npm ci
npm run build        # src/ → public/: pages per language, hashed assets, sitemap, robots, llms.txt, _headers
npm run dev          # http://localhost:8787 with the production headers (no injected endpoints: only public probes)
```

`npm run dev` serves the files with no endpoint metas, so the page runs the no-meta path (public probes only, with its
count). To try the injected path locally, add the two metas to `src/page.html` with placeholder values for a moment
(never commit them) and rebuild.

`SITE_URL=https://<your-domain> npm run build` for another domain (canonical links, sitemap, llms.txt).

## Test: pick by what changed

| Change | Run |
| --- | --- |
| Anything | `npm test`: public/ matches src/, the page contract, the logic tests in `test/` |
| A probe or a reader | `npm run verify` from a dual-stack network: every HTTPS probe answers one GET with no redirect, allows CORS, and returns a readable address |
| A headline (`vh_*`) or the page title (`h1`) | `npm run og`, commit the redrawn images in `public/og/` |
| Strings or layout | open the page at 375 px wide in Russian and German (the longest) after a run: no horizontal scroll, the verdict on the first screen |
| `src/lib.mjs` (grouping, findings, share format) | add a case to `test/lib.test.mjs` |
| `src/relay.mjs` (iCloud Private Relay ranges) | `npm run relay` re-reads Apple's list, then `npm test` |
| `server/` | `go vet ./... && go test ./...` in `server/`, then on a server (below) |

## Deploy

The page: `npx wrangler deploy` (a static-assets Worker, free and unmetered), or copy `public/` to any static host;
`public/_headers` holds the security headers in Cloudflare's format. The WARP check reads `/cdn-cgi/trace` on the
page's own host, so it only works behind Cloudflare.

Our own probes are deploy data: the hosting site adds `<meta name="ms-anchors" content="cn=<base-url>;intl=<base-url>">` (a value may already be the full `/conn` URL)
and `<meta name="ms-egress" content="stun=<host>:<port>,…;echo=<base-url>[,<base-url>]">` to the page (on 1ms.dog the
shell does it for every tool page). The echo bases come in server order: first the Tokyo one, then the mainland one; a
STUN host joins the server whose echo host shares its last two labels. The ports stay in `src/probes.mjs`. Without the
metas the page runs only the public probes, saying so — that is the self-hosted default.

The echo server is optional: without it the page works, and the group of probes that use it shows "no answer".

### Self-host the echo server

1. Two DNS names pointing straight at the server (no CDN proxy in front: the server must see the visitor's own
   connection): `<stun-domain>` and `<echo-domain>`, with A and AAAA records.
2. A certificate for `<echo-domain>` (for example certbot with webroot or DNS-01).
3. Get the program. For linux/amd64, download the latest build and check it; no Go needed:
   ```bash
   cd /tmp
   curl -fsSLO https://github.com/yt1988/egresslens/releases/latest/download/egress-echo
   curl -fsSLO https://github.com/yt1988/egresslens/releases/latest/download/SHA256SUMS
   sha256sum -c SHA256SUMS       # must print "egress-echo: OK"
   ```
   Each change to `server/` on main publishes a Release tagged `server-<short commit>` (`.github/workflows/server-release.yml`:
   static, `CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`), always marked latest; an older build is under its own tag
   at `releases/download/server-<commit>/egress-echo`. For another architecture, or to build it yourself, anywhere with Go:
   ```bash
   cd server && go test ./... && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o egress-echo .
   ```
4. Copy `egress-echo` to `/opt/<app>/`, create a system user for it, and run it under systemd. `server/1ms-egress.service`
   is a working unit: change the user, the path and the certificate directory (`LoadCredential=` reads the chain and
   key, so the user needs no access to the key itself). Flags: `-udp` and `-tcp` take the port lists, `-ws` the HTTPS
   port that also serves `/ws`, `-cert` and `-key` the PEM files. Without a certificate the HTTPS ports stay off and
   STUN still runs.
5. Open the ports in the firewall, for IPv4 and IPv6: UDP 3478, 19302, 51820, 40000 and TCP 4433, 8080, 8443, 9443,
   10443 by default. HTTPS ports must not be ones browsers refuse (22, 25 and the rest of Chrome's list), and plain
   HTTP won't do: an https page can't read it.
6. Check from another network: `curl https://<echo-domain>:8443/` returns your own address and port; a STUN Binding
   request to `<stun-domain>:3478` returns it in XOR-MAPPED-ADDRESS.

## Layout

```
src/probes.mjs       the probes: group, URL and how to read each answer; own probes name the endpoint they need
src/lib.mjs          pure logic (readers, exit grouping, D/P labels, findings, NAT, share links), unit-tested
src/egress.js        the site-wide exit rules, vendored verbatim from 1ms.dog (do not edit here)
src/relay.mjs        iCloud Private Relay ranges, generated by scripts/relay.mjs from Apple's list
src/app.js           browser code: runs the probes, renders exits, findings and rows; embed mode for a checkup host
src/page.html        page template; src/style.css; src/i18n/*.mjs strings for 10 languages
scripts/build.mjs    builds public/; scripts/og.mjs the link-preview images; scripts/verify.mjs checks live probes;
                     scripts/relay.mjs refreshes src/relay.mjs
server/              the echo server (Go) and its systemd unit
test/                logic and page-contract tests (node --test)
```

When the page runs under the 1ms.dog shell, the shell injects the navigation, statistics and `<meta>` tags that turn
on links to sibling tools and the embed mode. Self-hosted, none of that appears and the page works the same.

## 提交说明

- 用英文，一句话说清改了什么。
- 引用站内 issue 时只写 `#<数字>`，不要写 `yt1988/<私有仓库>#<数字>`，也不要写出私有仓库的名字；公开仓库的历史里不该出现内部仓库。
