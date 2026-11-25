// Endpoint authentication (1ms.dog docs/tool-contract.md, "端点鉴权"): our measurement endpoints accept the short-lived
// token a page carries, or the long-lived service token; anything else is 401. With MS_AUTH_SECRET unset nothing is
// checked: that is the self-hosted default and the switch that rolls the check out service by service.
//
// A token is "v1.<exp seconds>.<nonce>.<scope>.<hmac>": the scope (a comma list of capabilities) is signed over
// "v1|exp|nonce|scope" and travels in the token, and the HMAC is base64url without padding. This server needs "echo",
// which the service token's "*" also covers.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type auth struct{ keys [][]byte }

// newAuth turns MS_AUTH_SECRET into keys. A hex secret (openssl rand -hex 32) is accepted both as the text and as the
// bytes it encodes, so the signer's choice of either convention verifies.
func newAuth(secret string) auth {
	if secret == "" {
		return auth{}
	}
	keys := [][]byte{[]byte(secret)}
	if b, err := hex.DecodeString(secret); err == nil && len(b) > 0 {
		keys = append(keys, b)
	}
	return auth{keys: keys}
}

func (a auth) enabled() bool { return len(a.keys) > 0 }

// token reads the bearer header, or ?token= for a WebSocket handshake (which cannot set headers).
func (a auth) token(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func (a auth) sign(key []byte, msg string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(msg))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// scopeHas: the capability is in the token's list ("*" covers every capability, for the service token)
func scopeHas(list, want string) bool {
	for _, s := range strings.Split(list, ",") {
		s = strings.TrimSpace(s)
		if s == want || s == "*" {
			return true
		}
	}
	return false
}

// check returns "" when the request may pass, else "no_token" or "bad_token".
func (a auth) check(r *http.Request) string {
	if !a.enabled() {
		return ""
	}
	tok := a.token(r)
	if tok == "" {
		return "no_token"
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 5 || parts[0] != "v1" {
		return "bad_token"
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || time.Now().Unix() >= exp {
		return "bad_token"
	}
	nonce, scope, mac := parts[2], parts[3], parts[4]
	msg := "v1|" + parts[1] + "|" + nonce + "|" + scope
	for _, key := range a.keys {
		if hmac.Equal([]byte(a.sign(key, msg)), []byte(mac)) {
			if scopeHas(scope, "echo") {
				return ""
			}
			return "bad_token"
		}
	}
	return "bad_token"
}

// wrap is the middleware around every route on an HTTPS echo port, /ws included. A CORS preflight passes without a
// token: the page's GET carries an Authorization header, so the browser asks first.
func (a auth) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Access-Control-Allow-Headers", "Authorization")
			h.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if reason := a.check(r); reason != "" {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Cache-Control", "no-store")
			h.Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			io.WriteString(w, reason+"\n")
			return
		}
		next.ServeHTTP(w, r)
	})
}
