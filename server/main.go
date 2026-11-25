// egress-echo: the server side of EgressLens.
//
// The browser can't open raw sockets, so the page asks this one Tokyo address over several protocols and ports
// and compares what it sees: the destination stays fixed, so a difference comes from the visitor's proxy rules.
//
//   - STUN Binding (RFC 5389) on UDP ports: answers with the address:port the request came from (XOR-MAPPED-ADDRESS).
//     A browser reaches it through WebRTC (iceServers stun:<host>:<port>).
//   - HTTPS on TCP ports: GET / answers {"ip","port","proto"} for the connection, readable from any origin.
//   - WebSocket on /ws (one TLS port): greets with {"v":1,"pop":"NRT"}, then echoes text frames, for round-trip timing.
//   - MS_AUTH_SECRET set: the HTTPS routes and /ws require the token the page carries (see auth.go); unset, nothing is
//     checked. STUN has no authentication of its own.
//
// Nothing is logged or stored: each answer goes back to the address that asked and is forgotten. Errors only.
package main

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"time"

	"github.com/coder/websocket"
)

func main() {
	udp := flag.String("udp", "3478,19302,51820,40000", "STUN ports")
	tcp := flag.String("tcp", "4433,8080,8443,9443,10443", "HTTPS echo ports")
	wsPort := flag.String("ws", "8443", "the HTTPS port that also serves /ws")
	cert := flag.String("cert", "", "certificate chain (PEM)")
	key := flag.String("key", "", "private key (PEM)")
	flag.Parse()
	log.SetFlags(0)

	for _, p := range split(*udp) {
		go stun(p)
	}
	// Without a certificate (before it is first issued) STUN still runs; the HTTPS ports wait for a restart.
	kp, err := tls.LoadX509KeyPair(*cert, *key)
	if err != nil {
		log.Printf("no certificate, HTTPS ports off: %v", err)
	} else {
		authn := newAuth(os.Getenv("MS_AUTH_SECRET"))
		cfg := &tls.Config{Certificates: []tls.Certificate{kp}, MinVersion: tls.VersionTLS12}
		for _, p := range split(*tcp) {
			go serve(p, p == *wsPort, cfg, authn)
		}
	}
	select {}
}

func split(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

/* ---------- STUN ---------- */

const cookie = 0x2112A442

func stun(port string) {
	c, err := net.ListenPacket("udp", ":"+port) // [::], both IPv4 and IPv6
	if err != nil {
		log.Fatalf("udp %s: %v", port, err)
	}
	pc := c.(*net.UDPConn)
	buf := make([]byte, 1500)
	for {
		n, from, err := pc.ReadFromUDPAddrPort(buf)
		if err != nil {
			continue
		}
		if r := answer(buf[:n], from); r != nil {
			pc.WriteToUDPAddrPort(r, from)
		}
	}
}

// answer builds the Binding success response for a Binding request, or nil for anything else.
// The reply (32 bytes for IPv4, 44 for IPv6) is at most a little over twice the smallest request, too small to amplify.
func answer(q []byte, from netip.AddrPort) []byte {
	if len(q) < 20 || binary.BigEndian.Uint16(q[0:2]) != 0x0001 || binary.BigEndian.Uint32(q[4:8]) != cookie ||
		int(binary.BigEndian.Uint16(q[2:4]))+20 != len(q) {
		return nil
	}
	ip := from.Addr().Unmap()
	alen := 8
	if ip.Is6() {
		alen = 20
	}
	r := make([]byte, 20+4+alen)
	binary.BigEndian.PutUint16(r[0:2], 0x0101)
	binary.BigEndian.PutUint16(r[2:4], uint16(4+alen))
	copy(r[4:20], q[4:20]) // cookie and transaction id
	a := r[20:]
	binary.BigEndian.PutUint16(a[0:2], 0x0020) // XOR-MAPPED-ADDRESS
	binary.BigEndian.PutUint16(a[2:4], uint16(alen))
	binary.BigEndian.PutUint16(a[6:8], from.Port()^uint16(cookie>>16))
	if ip.Is4() {
		a[5] = 1
		v := ip.As4()
		binary.BigEndian.PutUint32(a[8:12], binary.BigEndian.Uint32(v[:])^cookie)
	} else {
		a[5] = 2
		v := ip.As16()
		for i := range v {
			a[8+i] = v[i] ^ q[4+i] // XOR with the cookie and the transaction id
		}
	}
	return r
}

/* ---------- HTTPS echo and /ws ---------- */

func serve(port string, ws bool, cfg *tls.Config, authn auth) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		cors(w, r) // the same header (and Vary) the 401 and the preflight carry
		h := w.Header()
		h.Set("Cache-Control", "no-store")
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		ap, _ := netip.ParseAddrPort(r.RemoteAddr)
		h.Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ip": ap.Addr().Unmap().String(), "port": ap.Port(), "proto": r.Proto})
	})
	if ws {
		mux.HandleFunc("/ws", echo)
	}
	s := &http.Server{
		Addr: ":" + port, Handler: authn.wrap(mux), TLSConfig: cfg.Clone(),
		ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8 << 10,
		ErrorLog: log.New(discard{}, "", 0), // handshake noise from scanners isn't an error worth keeping
	}
	log.Fatalf("tcp %s: %v", port, s.ListenAndServeTLS("", ""))
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

// allowed: pages on 1ms.dog and its subdomains over HTTPS, and local development
func allowed(origin string) bool {
	if strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") ||
		origin == "http://localhost" || origin == "http://127.0.0.1" {
		return true
	}
	return origin == "https://1ms.dog" || (strings.HasPrefix(origin, "https://") && strings.HasSuffix(origin, ".1ms.dog"))
}

// echo: the greeting, then each text frame sent straight back; at most 60 messages or 30 seconds, 64 bytes a frame
func echo(w http.ResponseWriter, r *http.Request) {
	if !allowed(r.Header.Get("Origin")) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // origin checked above
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(64)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if c.Write(ctx, websocket.MessageText, []byte(`{"v":1,"pop":"NRT"}`)) != nil {
		return
	}
	for i := 0; i < 60; i++ {
		t, m, err := c.Read(ctx)
		if err != nil {
			return
		}
		if t != websocket.MessageText {
			c.Close(websocket.StatusUnsupportedData, "text only")
			return
		}
		if c.Write(ctx, websocket.MessageText, m) != nil {
			return
		}
	}
	c.Close(websocket.StatusNormalClosure, "limit")
}
