package main

import (
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func authServer(secret string) *httptest.Server {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	return httptest.NewServer(newAuth(secret).wrap(ok))
}

// signed builds the token the contract specifies: v1.<exp>.<nonce>.<scope>.<hmac>
func signed(secret, scope string, exp int64) string {
	a := newAuth(secret)
	e := strconv.FormatInt(exp, 10)
	return "v1." + e + ".nonce123." + scope + "." + a.sign(a.keys[0], "v1|"+e+"|nonce123|"+scope)
}

func get(t *testing.T, url, token string, opts ...string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" && token != "-" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, strings.TrimSpace(string(b))
}

// With no secret the endpoint is open: the self-hosted default, and the switch that rolls the check out.
func TestAuthOffWithoutSecret(t *testing.T) {
	srv := authServer("")
	defer srv.Close()
	if code, _ := get(t, srv.URL, ""); code != http.StatusOK {
		t.Fatalf("no secret: %d", code)
	}
	if code, _ := get(t, srv.URL, "garbage"); code != http.StatusOK {
		t.Fatalf("no secret, bad token: %d", code)
	}
}

func TestAuthTokens(t *testing.T) {
	const secret = "test-secret-not-a-real-key"
	future := time.Now().Add(time.Minute).Unix()
	past := time.Now().Add(-time.Minute).Unix()
	srv := authServer(secret)
	defer srv.Close()

	for _, c := range []struct {
		name, token, query string
		want               int
		reason             string
	}{
		{"no token", "", "", 401, "no_token"},
		{"garbage", "nope", "", 401, "bad_token"},
		{"expired", signed(secret, "echo", past), "", 401, "bad_token"},
		{"another scope", signed(secret, "probe,reach", future), "", 401, "bad_token"},
		{"page token", signed(secret, "echo", future), "", 200, ""},
		{"scope list in the token", signed(secret, "probe,echo,ipv6", future), "", 200, ""},
		{"service token", signed(secret, "*", future), "", 200, ""},
		{"four parts, the old shape", "v1." + strconv.FormatInt(future, 10) + ".nonce123.abc", "", 401, "bad_token"},
		{"tampered signature", signed(secret, "echo", future)[:len(signed(secret, "echo", future))-2] + "xx", "", 401, "bad_token"},
		{"query, for /ws", "", signed(secret, "echo", future), 200, ""},
	} {
		url := srv.URL + "/"
		token := c.token
		if c.query != "" {
			url += "?token=" + c.query
		}
		code, body := get(t, url, token)
		if code != c.want || body != c.reason {
			t.Errorf("%s: %d %q, want %d %q", c.name, code, body, c.want, c.reason)
		}
	}
}

// The page's GET carries an Authorization header, so the browser sends a CORS preflight first; it passes without a token.
func TestAuthPreflight(t *testing.T) {
	srv := authServer("test-secret-not-a-real-key")
	defer srv.Close()
	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/", nil)
	req.Header.Set("Origin", "https://egress.1ms.dog")
	req.Header.Set("Access-Control-Request-Headers", "authorization")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent || res.Header.Get("Access-Control-Allow-Origin") != "*" ||
		!strings.Contains(res.Header.Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatalf("preflight: %d %v", res.StatusCode, res.Header)
	}
}

// A hex secret (openssl rand -hex 32) may be signed either as the text or as the bytes it encodes; both verify.
func TestAuthHexSecret(t *testing.T) {
	const hexSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	a := newAuth(hexSecret)
	key, err := hex.DecodeString(hexSecret)
	if err != nil {
		t.Fatal(err)
	}
	e := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
	tok := "v1." + e + ".n.echo." + a.sign(key, "v1|"+e+"|n|echo")
	srv := authServer(hexSecret)
	defer srv.Close()
	if code, body := get(t, srv.URL, tok); code != http.StatusOK {
		t.Fatalf("hex-decoded key: %d %q", code, body)
	}
}
