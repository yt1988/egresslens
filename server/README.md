# egress-echo

The server side of EgressLens on the 1ms.dog VPS (Tokyo): one destination the page asks over several protocols and
ports, so a different exit can only come from the visitor's proxy rules. Ports, user and directory are assigned in
1ms-shell `docs/processes.md` ("专用服务器").

| | |
|---|---|
| STUN (RFC 5389 Binding) | `<stun-domain>`, UDP 3478, 19302, 51820, 40000, IPv4 and IPv6 |
| HTTPS echo | `<echo-domain>`, TCP 4433, 8080, 8443, 9443, 10443: `GET /` → `{"ip","port","proto"}`, any origin |
| WebSocket | `wss://<echo-domain>:8443/ws`: greets `{"v":1,"pop":"NRT"}`, then echoes text frames (64 bytes at most, 60 messages or 30 s), origins `https://1ms.dog`, `https://*.1ms.dog` and localhost; the 1ms.dog home page times round trips with it |

Nothing is logged or stored; errors only. Without a certificate the HTTPS ports stay off and STUN still runs.

**Endpoint tokens (optional).** With `MS_AUTH_SECRET` set in the environment, every HTTPS route and `/ws` requires the
short-lived token a page carries — `Authorization: Bearer v1.<exp>.<nonce>.<hmac>`, or `?token=` on a WebSocket
handshake — and answers 401 with `no_token` or `bad_token` otherwise. Unset means nothing is checked, which is the
self-hosted default. The secret lives in the environment only. STUN has no authentication of its own.

Each change here on main publishes a ready-made linux/amd64 build to a GitHub Release (latest:
`https://github.com/yt1988/egresslens/releases/latest/download/egress-echo`, with `SHA256SUMS`). To build it yourself,
on any machine with Go:

```bash
cd server && go test ./... && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o egress-echo .
```

Install it under `/opt/<app>/` and run it with systemd; `1ms-egress.service` is a working unit to adapt (user, path,
certificate directory read through `LoadCredential=`). The full steps are in the root AGENTS.md.
