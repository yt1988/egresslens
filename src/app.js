// Egress: asks probes at many kinds of destinations which address they see, then groups the answers into exits and
// says what they mean (split routing, WebRTC and IPv6 leaks). Everything runs in the browser; nothing is sent to this
// site. The build prepends `const PROBES, GROUPS` (src/probes.mjs) and inlines src/lib.mjs at the @lib marker below.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const D = JSON.parse($("#data").textContent);
  const L = window.LEGRESS || {}, LANG = D.lang;              // strings: /assets/l.<lang>.<hash>.js, loaded first
  const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "egress:theme", lang: "egress:lang", mask: "egress:mask" };
  // Taiwan is "中国台湾 / Taiwan, China" with the PRC flag (1ms-shell docs/tool-contract.md §5); every other region by its system name
  const TW = { "zh-CN": "中国台湾", "zh-TW": "中國台灣", en: "Taiwan, China", ja: "中国台湾", ko: "중국 대만", es: "Taiwán, China", fr: "Taïwan, Chine", de: "Taiwan, China", pt: "Taiwan, China", ru: "Тайвань, Китай" };
  const country = cc => { if (cc === "TW") return TW[LANG]; try { return new Intl.DisplayNames([LANG], { type: "region" }).of(cc); } catch (e) { return cc; } };
  const flagCode = cc => cc === "TW" ? "cn" : cc.toLowerCase();
  const flag = cc => /^[A-Z]{2}$/.test(cc || "") ? `<img class="flag" src="/flags/${flagCode(cc)}.svg" alt="" width="20" height="15">` : "";
  const list = a => a.join(t("join"));
  /* @lib */
  const bust = u => u + (u.includes("?") ? "&" : "?") + "_eg=" + Math.random().toString(36).slice(2, 10);

  /* Findings lead on phones, including in reading and keyboard order. Move existing
     nodes only at the breakpoint, retaining handlers and focus across reparenting. */
  const phoneLayout = matchMedia("(max-width: 520px)");
  const heroBody = $(".hero-b"), exitsCol = $(".exits-col"), findsCol = $(".finds-col");
  const arrangeResults = () => {
    const first = phoneLayout.matches ? findsCol : exitsCol;
    if (heroBody.firstElementChild === first) return;
    const active = document.activeElement;
    heroBody.prepend(first);
    if (active && heroBody.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
  };
  arrangeResults();
  phoneLayout.addEventListener("change", arrangeResults);

  /* ---------- theme and language ---------- */
  const thBtn = $("#theme"), TH = ["system", "light", "dark"];
  const applyTheme = th => {
    if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); else document.documentElement.removeAttribute("data-theme");
    thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
  };
  applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
  thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
  // a shared result keeps its link (and its preview page) in the other language
  $("#lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = (S.shared ? D.paths : D.home)[l] + location.hash; };

  /* ---------- probes ---------- */
  const TZ_CC = Object.fromEntries(("Asia/Shanghai:CN Asia/Chongqing:CN Asia/Harbin:CN Asia/Urumqi:CN Asia/Hong_Kong:HK Asia/Macau:MO Asia/Taipei:TW Asia/Tokyo:JP " +
    "Asia/Seoul:KR Asia/Singapore:SG Asia/Kuala_Lumpur:MY Asia/Bangkok:TH Asia/Jakarta:ID Asia/Manila:PH Asia/Ho_Chi_Minh:VN Asia/Saigon:VN " +
    "Asia/Kolkata:IN Asia/Calcutta:IN Asia/Dubai:AE Asia/Riyadh:SA Asia/Qatar:QA Asia/Jerusalem:IL Asia/Tel_Aviv:IL Asia/Karachi:PK Asia/Tehran:IR " +
    "Europe/London:GB Europe/Dublin:IE Europe/Paris:FR Europe/Berlin:DE Europe/Amsterdam:NL Europe/Brussels:BE Europe/Zurich:CH Europe/Rome:IT " +
    "Europe/Madrid:ES Europe/Lisbon:PT Europe/Stockholm:SE Europe/Oslo:NO Europe/Helsinki:FI Europe/Copenhagen:DK Europe/Warsaw:PL Europe/Vienna:AT " +
    "Europe/Prague:CZ Europe/Moscow:RU Europe/Istanbul:TR Europe/Kiev:UA Europe/Kyiv:UA Europe/Athens:GR Europe/Bucharest:RO Europe/Budapest:HU " +
    "Australia/Sydney:AU Australia/Melbourne:AU Australia/Brisbane:AU Australia/Perth:AU Australia/Adelaide:AU Pacific/Auckland:NZ " +
    "America/New_York:US America/Chicago:US America/Denver:US America/Los_Angeles:US America/Phoenix:US America/Anchorage:US Pacific/Honolulu:US " +
    "America/Toronto:CA America/Vancouver:CA America/Montreal:CA America/Edmonton:CA America/Mexico_City:MX America/Sao_Paulo:BR America/Santiago:CL " +
    "America/Bogota:CO America/Lima:PE America/Argentina/Buenos_Aires:AR Africa/Johannesburg:ZA Africa/Cairo:EG Africa/Lagos:NG Africa/Nairobi:KE")
    .split(" ").map(p => p.split(":")));
  const tzCc = () => { try { return TZ_CC[Intl.DateTimeFormat().resolvedOptions().timeZone] || ""; } catch (e) { return ""; } };
  const GROUP_OF = Object.fromEntries(PROBES.map(p => [p.id, p.read === "stun" ? "udp" : p.g]));
  const NAME_OF = id => { const p = PROBES.find(x => x.id === id); return p.self ? t("self_name") : p.g === "stack" ? p.name + " IPv" + p.fam : p.g === "udp" ? "STUN " + p.name : p.name; };
  const isStun = p => p.read === "stun";

  // A probe that gives no address says why, as { why, n }: "timeout", "http" (n = status), "net" (no connection:
  // blocked by the network, the proxy or an ad blocker), "parse" (an answer without a usable address), "stun".
  const fail = (why, n) => Object.assign(new Error(why), { why, n });
  async function httpProbe(p) {
    let r;
    try { r = await fetch(bust(p.url), { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(7000) }); }
    catch (e) { throw fail(e && e.name === "TimeoutError" ? "timeout" : "net"); }
    // this site without the 1ms.dog shell: its Cloudflare trace, if it has one
    if (p.self && r.status === 404) return httpProbe({ ...p, url: "/cdn-cgi/trace", read: "trace", self: 0 });
    if (!r.ok) throw fail("http", r.status);
    let res = null;
    try { const text = await r.text(); res = readProbe(p, p.read === "text" || p.read === "trace" ? text : JSON.parse(text)); } catch (e) {}
    if (!res) throw fail("parse");
    return [res];
  }
  // one peer connection per STUN server, so each server's answer is its own
  async function stunProbe(p) {
    if (!window.RTCPeerConnection) return [];
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: p.url }] });
      pc.createDataChannel("x");
      const ips = new Set();
      const done = new Promise(res => {
        pc.onicecandidate = e => { if (!e.candidate) return res(); const ip = srflxOf(e.candidate.candidate); if (ip) ips.add(ip); };
        setTimeout(res, 4000);
      });
      await pc.setLocalDescription(await pc.createOffer());
      await done;
      return [...ips].map(ip => ({ ip }));
    } finally { try { pc && pc.close(); } catch (e) {} }
  }

  // the NAT type's probe: every STUN server on one peer connection (one socket), its srflx candidates (natOf in src/lib.mjs)
  async function natProbe() {
    if (!window.RTCPeerConnection) return [];
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: PROBES.filter(isStun).map(p => ({ urls: p.url })) });
      pc.createDataChannel("x");
      const out = [];
      const done = new Promise(res => {
        pc.onicecandidate = e => { if (!e.candidate) return res(); const c = srflxAt(e.candidate.candidate); if (c) out.push(c); };
        setTimeout(res, 5000);
      });
      await pc.setLocalDescription(await pc.createOffer());
      await done;
      return out;
    } catch (e) { return []; } finally { try { pc && pc.close(); } catch (e) {} }
  }

  /* ---------- state and rendering ---------- */
  // shared: a result from a link being shown (no addresses; nothing is tested until the visitor asks)
  const S = { res: {}, ok: {}, ms: {}, why: {}, geo: {}, warp: "off", exits: [], finds: [], odd: {}, nat: null, done: false, gen: 0, shared: null };
  const masked = () => store.get(K.mask) === "1";
  const ipTxt = ip => masked() ? maskIp(ip) : ip;
  const eye = $("#eye");
  function applyMask() {
    eye.textContent = t(masked() ? "show" : "hide"); eye.setAttribute("aria-pressed", masked());
    for (const p of PROBES) if (S.res[p.id]) renderRow(p);
    if (S.done) renderExits();
    renderFocus();
  }
  eye.onclick = () => { store.set(K.mask, masked() ? "0" : "1"); applyMask(); };

  // A row keeps its size from the start: only its text changes. Before a result, a row is reset to waiting.
  function renderRow(p) {
    const row = $("#p-" + p.id); if (!row) return;
    const res = S.res[p.id], ip = row.querySelector(".pip"), ms = row.querySelector(".pms"), co = row.querySelector(".pco");
    row.classList.toggle("fail", S.ok[p.id] === false); row.classList.toggle("wait", S.gen > 0 && S.ok[p.id] == null);
    // a row that stands out (no answer, another exit than its kind, a WebRTC leak) is tinted and says why on hover
    const o = S.done && S.odd[p.id], w = S.why[p.id];
    row.classList.toggle("odd", !!o && o.k === "odd"); row.classList.toggle("leak", !!o && o.k === "leak");
    const why = S.ok[p.id] === false && w ? t("why_" + w.why, { n: w.n }) : o ? t("why_" + o.k, { x: exTxt(o.x), y: exTxt(o.y) }) : "";
    if (why) { row.dataset.why = why; row.tabIndex = 0; } else { delete row.dataset.why; row.removeAttribute("tabindex"); }
    ms.textContent = ""; co.textContent = ""; ip.title = "";
    if (S.ok[p.id] == null) { ip.textContent = S.gen ? t("wait") : "–"; return; }
    if (S.ok[p.id] === false) { ip.textContent = t("fail"); return; }
    ip.textContent = S.shared ? "•••" : res.map(r => ipTxt(r.ip)).join(" · ");
    if (!masked()) ip.title = ip.textContent;
    if (S.ms[p.id] != null) ms.textContent = Math.round(S.ms[p.id]) + " ms";
    const cf = res[0] && res[0].cf;
    if (cf && cf.colo) co.textContent = cf.colo;
  }
  const kindOf = l => (S.exits.find(e => e.letter === l) || {}).kind || "proxy";
  // each numbered exit has its own shade: D1/D2 greens, P1…P4 orange, violet, pink, red
  const chip = (l, big) => `<i class="lt k-${kindOf(l)} n${(/\d+$/.exec(l) || [1])[0]}${big ? " big" : ""}">${esc(l)}</i>`;
  function renderChips() {
    const of = exitOfProbe(S.exits);
    for (const p of PROBES) {
      const c = document.querySelector("#p-" + p.id + " .pl");
      // the exit's label and its country's flag
      if (c) c.innerHTML = (of[p.id] || []).map(l => chip(l) + flag((S.exits.find(e => e.letter === l) || {}).cc)).join("");
    }
  }
  const whereOf = e => [e.city, e.cc && country(e.cc)].filter(Boolean).join(", ") || "?";
  // an exit in plain text (the tooltip): its label and country
  const exTxt = l => { const e = S.exits.find(x => x.letter === l); return e ? `${l} ${e.cc ? country(e.cc) : whereOf(e)}` : l || ""; };
  // in a sentence an exit is its chip and country: short, and the card above has the rest
  const exRef = l => { const e = S.exits.find(x => x.letter === l); return e ? `${chip(l)} ${esc(e.cc ? country(e.cc) : whereOf(e))}` : esc(l); };
  // While probes answer, the exits fill two slots drawn at the start (most visitors have a local line and a proxy);
  // an address shows once its network is known. The final sort, numbering and any extra exit come at the end.
  // a host can announce an IP quality check with <meta name="ipqs" content="https://…">: each address links to it
  // (not while addresses are hidden)
  const IPQS = (document.querySelector('meta[name="ipqs"]') || {}).content || "";
  // other 1ms.dog tools the host announces as <meta name="<tool>" content="https://…">; a link to one is shown only then.
  // Their pages share this page's language folders.
  const meta = n => (document.querySelector(`meta[name="${n}"]`) || {}).content || "";
  const ASN = meta("asn"), IPV6 = meta("ipv6");
  const toolHref = (base, at) => base + D.home[LANG] + at;
  // an AS number links to its page on ASN Lookup
  // a link to another 1ms.dog tool ends in the external-link icon (the shared tool contract: no arrows); a value that is
  // itself the link (an address, an AS number) has no icon: a dotted underline, and a title saying where it goes
  const EXT = '<svg class="xi" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
  const asRef = n => ASN ? `<a class="asl" href="${esc(toolHref(ASN, "AS" + n))}" title="${esc(t("asn_title"))}" target="_blank" rel="noopener">AS${n}</a>` : "AS" + n;
  const ipQ = ip => IPQS && !masked() ? `<a class="ipq" href="${esc(IPQS)}/?ip=${encodeURIComponent(ip)}" title="${esc(t("ipq_title"))}" target="_blank" rel="noopener">${esc(ip)}</a>` : esc(ipTxt(ip));
  const exCard = e => {
    // a shared result has no addresses: only which IP versions the exit has
    const ips = [4, 6].map(f => [f, e.ips.filter(ip => fam(ip) === f)]).map(([f, l]) => l.length ? `<span><em>IPv${f}</em>${l.map(ipQ).join(" · ")}</span>`
      : S.shared && e["v" + f] ? `<span><em>IPv${f}</em>•••</span>` : "").join("");
    return `<li class="ex">${chip(e.letter, true)}<div class="ex-b">` +
      `<div class="where">${flag(e.cc)}<b>${esc(whereOf(e))}</b>${e.org || e.asn ? `<span class="m">${esc(e.org)}${e.asn ? (e.org ? " · " : "") + asRef(e.asn) : ""}</span>` : ""}</div>` +
      `<div class="ips">${ips}</div>` + (tunOf(e) ? `<div class="m tun">${esc(t("ex_tun", { n: tunOf(e) }))}</div>` : "") + `</div></li>`;
  };
  // the MSS 1ms.dog's TCP 443 read, when this exit carried that connection and the MSS suggests a tunnel
  const tunOf = e => { const r = (S.res.t443 || [])[0]; return r && e.ips.includes(r.ip) && tunneled(r.ip, r.mss) ? r.mss : 0; };
  const slot = () => `<li class="ex sk"><i class="lt big k-none">?</i><span class="blink">${esc(t("sniff"))}</span></li>`;
  function renderExits() {
    const ul = $("#exList"), E = S.exits;
    if (S.done && !E.length) { ul.innerHTML = `<li class="ex sk">${esc(t("no_net"))}</li>`; return; }
    ul.innerHTML = E.map(exCard).join("") + (S.done ? "" : slot().repeat(Math.max(0, 2 - E.length)));
  }
  // While running, each probe group's heading in the list counts its answers.
  function renderGroups() {
    for (const g of GROUPS) {
      const ids = PROBES.filter(p => p.g === g).map(p => p.id), d = ids.filter(id => S.ok[id] != null).length;
      const el = document.querySelector(`[data-g="${g}"] .pg-n`);
      if (el) el.textContent = S.gen ? `${d} / ${ids.length}` : "";
    }
  }
  // The check table: seven rows drawn by the build, each a label and a value. While running a value is a skeleton bar;
  // when every probe is in, each row gets its status mark and its value.
  const ST = { ok: "✓", warn: "!", bad: "✕", info: "•", none: "–" };
  // a host can announce its privacy check with <meta name="who" content="https://…">
  const WHO = (document.querySelector('meta[name="who"]') || {}).content || "";
  // and its streaming & AI unlock check with <meta name="unlock" content="https://…">: it tests the visitor's own route, so not on a shared result
  const UNLOCK = (document.querySelector('meta[name="unlock"]') || {}).content || "";
  function renderChecks() {
    const isExit = x => S.exits.some(e => e.letter === x);
    for (const row of CHECKS) {
      const li = document.querySelector(`#finds [data-r="${row}"]`); if (!li) continue;
      const st = li.querySelector(".st"), val = li.querySelector(".fr-v");
      li.className = "fr";
      if (!S.done) { li.classList.add("wait"); st.textContent = ""; val.innerHTML = "<span class=\"bar\"></span>"; continue; }
      const f = S.finds[row], v = {};
      for (const [k, x] of Object.entries(f.v)) {
        if (k === "list") v[k] = esc(list(x.map(NAME_OF)));
        else if (k === "groups") v[k] = x.map(g => t("v_except_some", { list: esc(list(g.list.map(id => id === "@v6" ? t("v6_sites") : NAME_OF(id)))), x: exRef(g.x) })).join(" · ");
        else if (k === "x" && f.v.c) v[k] = `${chip(x)} ${esc(country(f.v.c))}`;
        else if (typeof x === "string") v[k] = isExit(x) ? exRef(x) : /^[A-Z]{2}$/.test(x) ? esc(country(x)) : esc(x);
      }
      li.classList.add("st-" + f.s); st.textContent = ST[f.s];
      li.classList.toggle("focus", row === D.focus);
      val.innerHTML = (f.s === "none" ? esc(t("v_none")) : f.k === "some" ? v.groups : t(`v_${row}_${f.k}`, v) + (row === "port" && v.groups ? " · " + v.groups : "") + (f.v.dc ? esc(t("v_dc")) : "") + (f.v.multi ? esc(t("v_nat_multi")) : "") + (f.v.px ? esc(t("v_nat_px")) : "")) +
        // a WebRTC leak or split routing: the privacy check shows what else gives the visitor away
        (WHO && ((row === "rtc" && f.s === "bad") || (row === "route" && f.k === "split")) ? ` <a class="xl" href="${esc(WHO + D.home[LANG])}" target="_blank" rel="noopener">${esc(t("who_link"))}${EXT}</a>` : "") +
        // the AI region: the unlock check tries each AI service from this route
        (UNLOCK && row === "ai" && f.s !== "none" && !S.shared ? ` <a class="xl" href="${esc(toolHref(UNLOCK, "ai/"))}" target="_blank" rel="noopener">${esc(t("unlock_link"))}${EXT}</a>` : "");
    }
  }
  // A landing page's lead panel (WebRTC leak test, what ChatGPT and Claude see): one row per probe it is about,
  // filled as each answers, and the verdict on top once every probe is in.
  const foEl = $("#focus");
  // The IPv6 row links to the IPv6 test when there is no IPv6 exit, or IPv6 leaves by another exit than websites abroad
  function linkChecks() {
    if (!S.done || !IPV6) return;
    const f = S.finds.v6, r = S.finds.route, li = document.querySelector('#finds [data-r="v6"] .fr-v');
    if (!f || !li || li.querySelector(".v6l")) return;
    const abroad = r && r.s !== "none" ? (r.k === "split" ? r.v.b : r.v.a) : null;
    if (f.k === "none" || f.s === "bad" || (f.v.a && f.v.a !== abroad))
      li.insertAdjacentHTML("beforeend", ` <a class="xl v6l" href="${esc(toolHref(IPV6, ""))}" target="_blank" rel="noopener">${esc(t("ipv6_link"))}${EXT}</a>`);
  }
  // links the build leaves hidden: [data-m] names the tool's meta, [data-at] the path after the language folder
  for (const a of document.querySelectorAll("a[data-m]")) { const m = meta(a.dataset.m); if (m) { a.href = toolHref(m, a.dataset.at); a.hidden = false; } }
  function renderFocus() {
    linkChecks();
    if (!foEl) return;
    const of = exitOfProbe(S.exits), ex = l => S.exits.find(e => e.letter === l);
    const place = cc => cc ? flag(cc) + `<span>${esc(country(cc))}</span>` : "";
    for (const li of foEl.querySelectorAll(".fo-r")) {
      const id = li.dataset.p, x = li.querySelector(".fo-x"), m = li.querySelector(".fo-m");
      let bad = false;
      m.textContent = "";
      if (S.ok[id] == null) x.innerHTML = S.gen ? `<span class="m blink">…</span>` : `<span class="m">–</span>`;
      else if (!S.ok[id]) x.innerHTML = `<span class="m">${esc(t("fail"))}</span>`;
      else if (D.focus === "ai") {
        // the country the AI site itself sees (its Cloudflare trace), and the exit that took the request
        const cf = (S.res[id][0] || {}).cf || {};
        // the region list is OpenAI's and Anthropic's, so only their sites are marked
        bad = ["chatgpt", "openai", "sora", "claude", "anthropic"].includes(id) && AI_BLOCKED.includes(cf.loc);
        x.innerHTML = (of[id] || []).map(l => chip(l)).join("") + place(cf.loc);
        m.textContent = cf.colo || "";
      } else {
        bad = !!(S.done && S.odd[id] && S.odd[id].k === "leak");
        x.innerHTML = (of[id] || []).map(l => chip(l) + place(ex(l).cc)).join(" ");
        m.textContent = S.shared ? "•••" : S.res[id].map(r => ipTxt(r.ip)).join(" · ");
      }
      li.classList.toggle("bad", bad);
    }
    const head = foEl.querySelector(".fo-t"), st = foEl.querySelector(".st"), d = foEl.querySelector(".fo-d");
    foEl.className = "focus";
    if (!S.done) { head.textContent = t("sniff"); st.textContent = ""; d.innerHTML = "<span class=\"bar\"></span>"; foEl.classList.add("wait"); return; }
    const f = S.finds[D.focus] || { s: "none" };
    const k = f.s === "bad" ? "vh_ai" : f.s === "ok" ? "fh_ai_ok" : "fh_ai_none";
    head.textContent = t(k); st.textContent = ST[f.s]; foEl.classList.add("st-" + f.s);
    // the detail is the check table's own value for this check, without its links
    const v = document.querySelector(`#finds [data-r="${D.focus}"] .fr-v`).cloneNode(true);
    v.querySelectorAll(".xl").forEach(a => a.remove());
    d.innerHTML = f.s === "none" ? "" : v.innerHTML;
  }
  function setProg(d, n) {
    $("#prog").classList.toggle("end", S.done); $("#prog i").style.transform = `scaleX(${n ? d / n : 0})`; $("#progTxt").textContent = !S.gen ? "" : S.done ? t("done", { n }) : t("progress", { d, n });
    if (EMBED && S.gen) { post({ type: "progress", done: d, total: n, text: $("#progTxt").textContent }); sendSize(); }
  }

  /* ---------- embedded in the connection checkup (1ms-shell docs/checkup.md) ---------- */
  // Only when the page is opened with ?embed=checkup from the origin the host names in <meta name="check">; otherwise it
  // is the ordinary page. The host marks the page with <html data-ms-embed>, which the compact layout keys on.
  const EMBED = (() => {
    const at = meta("check");
    let from = "";
    try { from = new URL(document.referrer).origin; } catch (e) {}
    const on = new URLSearchParams(location.search).get("embed") === "checkup" && !!at && from === at;
    if (!on) document.documentElement.removeAttribute("data-ms-embed");
    return on ? at : "";
  })();
  const post = m => { try { parent.postMessage({ ms: "checkup", v: 1, tool: "egress", ...m }, EMBED); } catch (e) {} };
  // the height on every change, and after each step of a run too (a frame in a hidden tab may never see a resize)
  let sentH = 0;
  const sendSize = () => { const n = Math.ceil(document.documentElement.getBoundingClientRect().height); if (n !== sentH) post({ type: "size", height: sentH = n }); };
  if (EMBED) {
    document.documentElement.setAttribute("data-ms-embed", "checkup");
    new ResizeObserver(sendSize).observe(document.documentElement);
  }
  // the result, as the checkup report reads it: the page's headline, a few numbers, the check rows that say something
  // (worst first, as the page words them) and facts for its rules across tools
  function postResult() {
    const F = S.finds, rank = { bad: 0, warn: 1, ok: 2 }, cfOf = id => ((S.res[id] || [])[0] || {}).cf || {};
    // labels as the page shows them (the build fills them in; the strings file doesn't carry them)
    const label = r => document.querySelector(`#finds [data-r="${r}"] .fr-l`).textContent.trim(), head = k => $(`[data-i="${k}"]`).textContent.trim();
    const text = r => {
      const v = document.querySelector(`#finds [data-r="${r}"] .fr-v`).cloneNode(true);
      v.querySelectorAll(".xl").forEach(a => a.remove());
      return label(r) + t("colon") + v.textContent.trim();
    };
    const ai = PROBES.filter(p => p.g === "ai").map(p => cfOf(p.id).loc).find(c => /^[A-Z]{2}$/.test(c || ""));
    const nat = S.nat && S.nat.k !== "none" ? S.nat.k : "";
    const stats = [{ label: head("exits_h"), value: String(S.exits.length) }];
    if (ai) stats.push({ label: label("ai"), value: country(ai) });
    if (nat) stats.push({ label: label("nat"), value: t("v_nat_" + nat).split(/\s*[：:]\s*/)[0] });
    stats.push({ label: head("probes_h"), value: `${RUNS.filter(p => S.ok[p.id]).length} / ${RUNS.length}` });
    const u = new URL(shareLink(false));
    post({
      type: "result", lang: LANG, path: u.pathname + u.hash, grade: null, score: null,
      headline: S.exits.length ? t("vh_" + verdict()) : t("no_net"), stats,
      findings: CHECKS.filter(r => F[r] && F[r].s in rank).sort((a, b) => rank[F[a].s] - rank[F[b].s]).slice(0, 4).map(r => ({ level: F[r].s, text: text(r) })),
      facts: {
        exits: S.exits.map(e => ({ country: e.cc || null, isp: e.org || null, via: e.kind === "local" ? "direct" : "proxy" })),
        leak: F.rtc.s === "bad" || F.v6.s === "bad", split: F.route.k === "split",
        ...(ai && { aiCountry: ai }), ...(nat && { nat: nat === "sym" ? "symmetric" : "cone" }),
      },
    });
    sendSize();
  }

  /* ---------- a run ---------- */
  const seenAll = () => PROBES.flatMap(p => (S.res[p.id] || []).map(r => ({ ip: r.ip, probe: p.id })));
  // live view: only addresses whose network is known, so an address never shows as an exit of its own and then merges
  let raf = 0;
  const live = () => { if (raf) return; raf = requestAnimationFrame(() => {
    raf = 0; if (S.done) return;
    S.exits = groupExits(seenAll().filter(s => geoOf(S.geo, s.ip)), S.geo, GROUP_OF, S.warp);
    renderExits(); renderChips(); renderFocus();
  }); };
  // A landing page tests only what it is about: its own probes, and the mainland and abroad baselines that tell the
  // direct exit from the proxy (docs: 1ms-shell tool-contract, "subpages test only their own item")
  const RUNS = D.focus ? PROBES.filter(p => [D.focusGroup, "cn", "intl"].includes(p.g)) : PROBES;
  async function run() {
    leaveShared();
    const gen = ++S.gen;
    // clear everything the last run showed: exits, findings, and every probe row
    Object.assign(S, { res: {}, ok: {}, ms: {}, why: {}, geo: {}, warp: "off", exits: [], finds: {}, odd: {}, nat: null, done: false, err: false });
    renderExits(); renderGroups(); renderChecks(); renderFocus();
    $("#run").disabled = true; $("#run").classList.add("busy"); $("#run span").textContent = t("running"); renderVerdict();
    for (const p of PROBES) { renderRow(p); const c = document.querySelector("#p-" + p.id + " .pl"); if (c) c.innerHTML = ""; }
    // this site's own Cloudflare trace says whether WARP carries the traffic (absent when self-hosted elsewhere)
    fetch("/cdn-cgi/trace", { cache: "no-store", signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.text() : "")
      .then(x => { S.warp = parseTrace(x).warp || "off"; }).catch(() => {});
    // an address no geo-aware probe has seen (text-only probes, WebRTC) is looked up right away, once per network
    const lookups = [], looked = new Set();
    const lookup = ip => {
      if (geoOf(S.geo, ip) || looked.has(netOf(ip)) || looked.size >= 8) return;
      looked.add(netOf(ip));
      lookups.push(fetch("https://api.ip.sb/geoip/" + encodeURIComponent(ip), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(6000) })
        .then(r => r.ok ? r.json() : Promise.reject()).then(b => { const r = READERS.ipsb(b); if (gen === S.gen && r.geo) { S.geo[ip] = r.geo; live(); } }).catch(() => {}));
    };
    const natP = D.focus ? Promise.resolve([]) : natProbe();
    let d = 0; setProg(0, RUNS.length);
    // Embedded: when the probes elsewhere all fail (an ad blocker takes them as a batch), say so at once rather than
    // after every timeout, and send no result. This site's own probe doesn't count: blockers leave it alone.
    let won = 0, lost = 0;
    const blocked = () => { if (EMBED && !S.err && !won) { S.err = true; post({ type: "error", text: t("embed_blocked") }); } };
    const blockT = EMBED && setTimeout(blocked, 15000);
    await Promise.all(RUNS.map(async p => {
      const t0 = performance.now();
      let res = [];
      try { res = await (p.read === "stun" ? stunProbe(p) : httpProbe(p)); } catch (e) { res = []; S.why[p.id] = { why: e.why || "net", n: e.n }; }
      if (!res.length && !S.why[p.id]) S.why[p.id] = { why: "stun" };
      if (gen !== S.gen) return;
      S.ms[p.id] = p.read === "stun" ? null : performance.now() - t0;
      S.ok[p.id] = res.length > 0; S.res[p.id] = res;
      for (const r of res) if (r.geo && (r.geo.cc || r.geo.asn) && !S.geo[r.ip]) S.geo[r.ip] = r.geo;
      // geo-aware answers first, so a lookup isn't spent on a network another probe is about to name
      setTimeout(() => { if (gen === S.gen) for (const r of res) lookup(r.ip); }, 1200);
      if (!p.self) { if (res.length) won++; else if (++lost >= 12) blocked(); }
      renderRow(p); renderGroups(); setProg(++d, RUNS.length); live();
    }));
    clearTimeout(blockT);
    if (gen !== S.gen) return;
    for (const { ip } of seenAll()) lookup(ip);
    await Promise.allSettled(lookups);
    if (gen !== S.gen) return;
    S.exits = groupExits(seenAll(), S.geo, GROUP_OF, S.warp);
    const cf = Object.fromEntries(PROBES.map(p => [p.id, ((S.res[p.id] || [])[0] || {}).cf]).filter(([, c]) => c));
    const seen = Object.fromEntries(PROBES.filter(isStun).map(p => [p.id, (S.res[p.id] || []).map(r => r.ip)]));
    S.nat = natOf(await natP, seen, S.exits);
    if (gen !== S.gen) return;
    S.finds = findings(PROBES, S.exits, cf, tzCc(), S.nat);
    S.odd = oddProbes(PROBES, S.exits);
    S.done = true;
    renderExits(); renderChips(); renderChecks(); renderFocus(); for (const p of PROBES) renderRow(p); setProg(RUNS.length, RUNS.length);
    $("#run").disabled = false; $("#run").classList.remove("busy"); $("#run span").textContent = t("rerun"); renderVerdict();
    if (EMBED && !won) blocked();
    if (EMBED && !S.err) postResult();
  }

  // leaving a shared result's page (/r/…, whose title is the verdict) opens the language's own page, which tests at once
  $("#run").onclick = () => { if ((S.shared || S.badLink) && location.pathname !== D.home[LANG]) location.href = D.home[LANG]; else run(); };

  /* ---------- a row's reason, on hover or focus ---------- */
  const tip = document.body.appendChild(Object.assign(document.createElement("div"), { className: "tip", role: "tooltip" }));
  const showTip = row => {
    tip.textContent = row.dataset.why;
    const r = row.getBoundingClientRect(), w = Math.min(tip.offsetWidth, innerWidth - 16);
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + 120)) + "px"; tip.style.top = r.bottom + 4 + "px";
    tip.classList.add("on");
  };
  const list_ = $(".pgroups");
  list_.addEventListener("mouseover", e => { const row = e.target.closest(".pr[data-why]"); row ? showTip(row) : tip.classList.remove("on"); });
  list_.addEventListener("mouseleave", () => tip.classList.remove("on"));
  list_.addEventListener("focusin", e => { const row = e.target.closest(".pr[data-why]"); if (row) showTip(row); });
  list_.addEventListener("focusout", () => tip.classList.remove("on"));
  addEventListener("scroll", () => tip.classList.remove("on"), { passive: true });

  /* ---------- questions: a dialog behind the ? button ---------- */
  const help = $("#help");
  $("#helpBtn").onclick = () => help.showModal ? help.showModal() : help.setAttribute("open", "");
  help.addEventListener("click", e => { if (e.target === help || e.target.closest("[data-close]")) help.close(); });

  /* ---------- a shared result ---------- */
  // Opening a result link shows that result, worked out again from what the link carries, and tests nothing until the
  // visitor asks for their own (the run button). Format and parsing: src/lib.mjs.
  function showShared(R) {
    Object.assign(S, { res: {}, ok: {}, ms: {}, why: {}, geo: {}, exits: R.exits, nat: R.nat, shared: R, done: true, gen: 0 });
    for (const p of PROBES) {
      const r = R.rows[p.id]; if (!r) continue;
      S.ok[p.id] = !r.why; S.ms[p.id] = r.ms;
      if (r.why) S.why[p.id] = r.why; else S.res[p.id] = [{ ip: "", cf: r.cf }];
    }
    const cf = Object.fromEntries(Object.entries(R.rows).filter(([, r]) => r.cf && !r.why).map(([id, r]) => [id, r.cf]));
    S.finds = findings(PROBES, S.exits, cf, R.tz, R.nat);
    S.odd = oddProbes(PROBES, S.exits);
    eye.hidden = true;
    renderExits(); renderChips(); renderChecks(); renderGroups(); renderFocus(); renderVerdict(); for (const p of PROBES) renderRow(p);
    $("#run span").textContent = t("test_mine"); $("#run").disabled = false;
    // the shared dialog's banner above the result: when it was shared, and a button for the visitor's own test
    import("/assets/share/share.js?v=10").then(({ received }) => {
      if (S.shared === R) S.banner = received({ lang: LANG, ts: R.ts, at: $(".hero"), test: () => $("#run").click() });
    }).catch(() => {});
  }
  function leaveShared() {
    if (S.badLink) { S.badLink = false; document.documentElement.removeAttribute("data-bad-link"); }
    else if (!S.shared) return;
    S.shared = null; eye.hidden = false; document.documentElement.removeAttribute("data-shared");
    if (S.banner) { S.banner.remove(); S.banner = null; }
    history.replaceState(null, "", D.home[LANG]);
  }

  // the result's one-line verdict under the headline, the share button beside it; hidden until there is a result
  function renderVerdict() {
    const on = S.done && S.exits.length > 0, v = on && verdict();
    $("#verdict").hidden = !on;
    if (!on) return;
    $("#vTxt").textContent = t("vh_" + v);
    $("#verdict").classList.toggle("bad", v === "leak" || v === "ai");
  }

  /* ---------- share: the shared dialog (/assets/share/, copied verbatim from 1ms-shell), a link that carries the result ---------- */
  const verdict = () => verdictOf(S.finds, S.exits) || "split";
  // The link opens the verdict's own page (/<lang>/r/<verdict>/), whose preview card states the verdict;
  // the result itself is in the hash, which never reaches a server
  function shareLink(withPlace) {
    const of = exitOfProbe(S.exits), rows = {};
    for (const p of PROBES) {
      if (S.ok[p.id] == null) continue;
      rows[p.id] = S.ok[p.id] ? { l: of[p.id] || [], ms: S.ms[p.id], cf: ((S.res[p.id] || [])[0] || {}).cf } : { why: S.why[p.id] };
    }
    const hash = encodeShare({ ts: S.shared ? S.shared.ts : Date.now(), tz: S.shared ? S.shared.tz : tzCc(), exits: S.exits, rows, place: withPlace, nat: S.nat });
    return location.origin + D.home[LANG] + "r/" + verdict() + "/" + hash;
  }
  $("#share").onclick = async () => {
    if (!S.done || !S.exits.length) return;
    const { share } = await import("/assets/share/share.js?v=10");
    share({
      lang: LANG, name: t("name"), file: "egresslens", show: ["city", "isp"], never: ["ip"],
      link: shareLink, home: location.origin + D.home[LANG], text: () => t("share_text", { v: t("vh_" + verdict()) }),
      height: (m, kit) => measure(m, kit).H, draw: drawCard, ts: S.shared ? S.shared.ts : Date.now(),
    }).open();
  };

  // The result on the card, in the page's theme: the verdict, the exits (country; city and network only when the
  // visitor ticks the box; never addresses) and the check table as the page shows it, exit chips in their colors.
  // The dialog draws the frame: logo, name, QR code and date.
  const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  // Fitted into a 1200 × 630 link preview, the card must still read: the verdict large on top, the exits on as few
  // lines as they take, then the check table one line per row (a value too long for it ends in "…").
  const EH = 54, RH = 44;
  function measure(m, kit) {
    const { W, P, F } = kit, VW = W - P - (P + 210);
    m.font = `700 52px ${F}`;
    const hLines = wrap(m, t("vh_" + verdict()), W - P * 2);
    // the exits side by side: chip, flag, place, then kind (and network when shown), wrapping as needed
    const items = S.exits.map(e => {
      const where = (kit.show ? [e.city, e.cc && country(e.cc)] : [e.cc ? country(e.cc) : ""]).filter(Boolean).join(", ") || "?";
      const sub = t(e.kind === "local" ? "k_local" : "k_proxy") + (kit.show && e.org ? " · " + e.org : "");
      m.font = `600 26px ${F}`; const ww = m.measureText(where).width;
      m.font = `400 22px ${F}`; const sw = Math.min(m.measureText(sub).width, 380);
      return { e, where, sub, sw, w: chipW(m, kit, e.letter, 40) + 12 + (e.cc ? 42 : 0) + ww + 12 + sw };
    });
    const eLines = [[]]; let lw = 0;
    for (const it of items) {
      if (lw && lw + 40 + it.w > W - P * 2) { eLines.push([]); lw = 0; }
      eLines[eLines.length - 1].push(it); lw += (lw ? 40 : 0) + it.w;
    }
    // the check rows: each value as the page shows it, as tokens (a piece of text, or an exit chip), on one line
    const rows = CHECKS.map(r => {
      const li = document.querySelector(`#finds [data-r="${r}"]`), toks = [];
      for (const n of li.querySelector(".fr-v").childNodes) {
        if (n.nodeType === 1 && n.classList.contains("xl")) continue;          // links stay on the page
        if (n.nodeType === 1 && n.classList.contains("lt")) toks.push({ chip: n.textContent });
        else for (const w of (n.textContent || "").match(TOK) || []) toks.push({ w });
      }
      const lines = layout(m, kit, toks, VW), line = lines[0] || [];
      if (lines.length > 1) {
        m.font = `400 22px ${F}`;
        const ell = { w: "…", wd: m.measureText("…").width };
        while (line.length && line.reduce((a, tk) => a + tk.wd, 0) + ell.wd > VW) line.pop();
        while (line.length && line[line.length - 1].w && !line[line.length - 1].w.trim()) line.pop();
        line.push(ell);
      }
      return { label: li.querySelector(".fr-l").textContent, s: (S.finds[r] || {}).s || "none", line };
    });
    const hTop = kit.top + 52, eTop = hTop + (hLines.length - 1) * 62 + 74, cTop = eTop + eLines.length * EH;
    return { hLines, eLines, rows, hTop, eTop, cTop, H: cTop + rows.length * RH + 24 + 70 };
  }
  async function drawCard(x, kit) {
    const { W, P, F, v, dark, clip } = kit, VX = P + 210, { hLines, eLines, rows, hTop, eTop, cTop } = measure(x, kit);
    const C = { line: v("line"), fg: v("fg"), muted: v("muted"), ok: v("ok"), bad: v("bad"), warn: v("e-p1") };
    const colorOf = l => {
      const e = S.exits.find(x => x.letter === l), n = +((/\d+$/.exec(l) || [1])[0]);
      return !e ? C.muted : e.kind === "local" ? v(n === 2 ? "e-d2" : "e-d") : v("e-p" + (n >= 2 && n <= 4 ? n : 1));
    };
    const v0 = verdict();
    x.textBaseline = "alphabetic";
    x.fillStyle = v0 === "leak" || v0 === "ai" ? C.bad : C.fg; x.font = `700 52px ${F}`; hLines.forEach((l, i) => x.fillText(l, P, hTop + i * 62));
    // exits
    let y = eTop;
    for (const line of eLines) {
      let xx = P;
      for (const it of line) {
        chipAt(x, kit, it.e.letter, xx, y - 31, 40, colorOf(it.e.letter)); xx += chipW(x, kit, it.e.letter, 40) + 12;
        if (it.e.cc) { try { x.drawImage(await img(`/flags/${flagCode(it.e.cc)}.svg`), xx, y - 25, 32, 24); } catch (er) {} xx += 42; }
        x.fillStyle = C.fg; x.font = `600 26px ${F}`; x.fillText(it.where, xx, y - 2); xx += x.measureText(it.where).width + 12;
        x.fillStyle = C.muted; x.font = `400 22px ${F}`; x.fillText(clip(x, it.sub, it.sw), xx, y - 2); xx += it.sw + 40;
      }
      y += EH;
    }
    // the check table
    y = cTop;
    const MARK = { ok: "✓", warn: "!", bad: "✕", info: "•", none: "–" };
    for (const r of rows) {
      x.fillStyle = C.line; x.fillRect(P, y, W - P * 2, 1);
      const cx = P + 13, cy = y + RH / 2;
      x.beginPath(); x.arc(cx, cy, 13, 0, Math.PI * 2);
      if (["ok", "bad", "warn"].includes(r.s)) { x.fillStyle = C[r.s]; x.fill(); x.fillStyle = dark ? "#111" : "#fff"; }
      else { x.strokeStyle = C.line; x.lineWidth = 2; x.stroke(); x.fillStyle = C.muted; }
      x.font = `700 15px ${F}`; x.textAlign = "center"; x.fillText(MARK[r.s] || "–", cx, cy + 5); x.textAlign = "left";
      x.fillStyle = C.muted; x.font = `400 21px ${F}`; x.fillText(clip(x, r.label, VX - P - 54), P + 40, cy + 7);
      let xx = VX;
      for (const tk of r.line) {
        if (tk.chip) chipAt(x, kit, tk.chip, xx + 2, cy - 13, 26, colorOf(tk.chip));
        else { x.fillStyle = r.s === "bad" ? C.bad : C.fg; x.font = `400 22px ${F}`; x.fillText(tk.w, xx, cy + 8); }
        xx += tk.wd;
      }
      y += RH;
    }
    x.fillStyle = C.line; x.fillRect(P, y, W - P * 2, 1);
  }
  // an exit chip on the card: the page's tinted square, the label in the exit's color
  const chipW = (x, kit, l, h) => { x.font = `700 ${Math.round(h * .46)}px ${kit.M}`; return Math.max(h, x.measureText(l).width + h * .5); };
  function chipAt(x, kit, l, x0, y0, h, col) {
    const w = chipW(x, kit, l, h);
    x.fillStyle = col + "22"; kit.roundRect(x, x0, y0, w, h, h * .26); x.fill();
    x.strokeStyle = col + "55"; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = col; x.textAlign = "center"; x.fillText(l, x0 + w / 2, y0 + h * .68); x.textAlign = "left";
  }
  // words, or single CJK characters, with the space after them
  const TOK = /[　-鿿가-힯＀-￯]|[^\s　-鿿가-힯＀-￯]+\s*|\s+/g;
  function wrap(x, s, w) {
    const out = []; let line = "";
    for (const tok of s.match(TOK) || []) {
      if (line && x.measureText(line + tok).width > w) { out.push(line.trimEnd()); line = tok.trimStart(); } else line += tok;
    }
    if (line.trim()) out.push(line.trimEnd());
    return out;
  }
  // tokens into lines of width w, each token with its width (a chip: its square and a little space around it)
  function layout(x, kit, toks, w) {
    const lines = [[]]; let lw = 0;
    for (const tk of toks) {
      if (tk.chip) tk.wd = chipW(x, kit, tk.chip, 26) + 6;
      else { x.font = `400 22px ${kit.F}`; tk.wd = x.measureText(tk.w).width; }
      if (lw && lw + tk.wd > w && !(tk.w && !tk.w.trim())) {
        lines.push([]); lw = 0;
        if (tk.w) { tk.w = tk.w.trimStart(); tk.wd = x.measureText(tk.w).width; }
      }
      lines[lines.length - 1].push(tk); lw += tk.wd;
    }
    return lines;
  }

  /* ---------- reporting a problem (the host's dialog) ---------- */
  // When the host provides "Report a problem" (1ms-shell src/report.js), the dialog asks this page for what the visitor
  // saw: one line in the visitor's language, JSON that can reproduce the run, and the readings offered as one-tap
  // answers. Same scope as a shared link's default: no address leaves unmasked, and city and network stay out (the
  // share dialog's own opt-in fields). The check rows are read back as the page words them, so no new strings.
  const rpLabel = r => { const el = document.querySelector(`#finds [data-r="${r}"] .fr-l`); return el ? el.textContent.trim() : ""; };
  const rpValue = r => { const el = document.querySelector(`#finds [data-r="${r}"] .fr-v`); return el ? el.textContent.trim() : ""; };
  // a pick is one short line: the dialog already cuts them at 60 characters, cut here so the "…" is ours
  const rpPick = s => s.length > 60 ? s.slice(0, 59) + "…" : s;
  window.msReport = () => {
    if (!S.done) return null;
    const v0 = S.exits.length ? verdict() : "";
    // "what it tested and what it found": the tool's name, the verdict, how traffic is split, and where a leak is
    const bad = ["rtc", "v6", "ai"].find(r => S.finds[r] && S.finds[r].s === "bad");
    const summary = [t("name"), v0 ? t("vh_" + v0) : t("no_net"), S.exits.length ? rpValue("route") : "",
      bad ? rpLabel(bad) + t("colon") + rpValue(bad) : ""].filter(Boolean).join(" · ").slice(0, 300);
    // the probes that gave no address, by reason ("timeout", "http404", …): the commonest "nothing showed up" report
    const fail = {};
    for (const p of PROBES) if (S.ok[p.id] === false) {
      const w = S.why[p.id] || { why: "net" }, k = w.why === "http" && w.n ? "http" + w.n : w.why;
      (fail[k] = fail[k] || []).push(p.id);
    }
    // each exit and how it was told apart: masked addresses, the checkpoints that saw it (the grouping's evidence),
    // the data-center/WARP flags that make the D/P label, IPv4/IPv6, and the MSS hint of a tunnel
    const exits = S.exits.map(e => ({
      l: e.letter, k: e.kind, cc: e.cc || null, ips: e.ips.map(maskIp), probes: e.probes,
      ...(e.dc ? { dc: 1 } : {}), ...(e.warp ? { warp: 1 } : {}), ...(e.v4 ? { v4: 1 } : {}), ...(e.v6 ? { v6: 1 } : {}),
      ...(tunOf(e) ? { tun: tunOf(e) } : {}),
    }));
    // the check rows as the page decided them. Their "which probes" lists (except/port) are left out: the same
    // evidence is in each exit's probes, and the dialog cuts the JSON at 6 KB
    const checks = Object.fromEntries(CHECKS.filter(r => S.finds[r]).map(r => {
      const f = S.finds[r], v = { ...f.v };
      delete v.groups;
      return [r, { s: f.s, k: f.k, v }];
    }));
    const data = {
      v: 1, lang: LANG, shared: S.shared ? 1 : 0, ...(D.focus ? { focus: D.focus } : {}),
      verdict: v0 || null, warp: S.warp || "off", tz: tzCc() || null,
      nat: S.nat && S.nat.k ? S.nat.k : null, ...(S.nat && S.nat.multi ? { natMulti: 1 } : {}),
      exits, checks,
      ...(Object.keys(fail).length ? { fail } : {}),
    };
    // what a visitor most often says is wrong, as "what it read" one-tap answers: each exit, the routing row, then
    // every check that did not come out clean (leak, exceptions, ports, NAT, time zone…)
    const picks = [];
    for (const e of S.exits) picks.push(rpPick(`${e.letter}${t("colon")}${[e.cc ? country(e.cc) : "?", t(e.kind === "local" ? "k_local" : "k_proxy")].join(" · ")}`));
    for (const r of CHECKS) {
      const f = S.finds[r];
      if (f && f.s !== "none" && (r === "route" || f.s !== "ok")) picks.push(rpPick(rpLabel(r) + t("colon") + rpValue(r)));
    }
    return { summary, data, picks: picks.filter(Boolean).slice(0, 8) };
  };
  // The entry beside the verdict: it starts the shell's dialog with its box filled in, so a visitor who sends it as it
  // is gets the dialog's "which part is wrong?" question and this run's picks. Shown only where the host has the
  // dialog (1ms-shell injects msOpenReport in the page head; a self-hosted copy has neither and keeps it hidden).
  const rpAsk = $("#rpAsk");
  if (rpAsk && typeof window.msOpenReport === "function" && !EMBED) { rpAsk.setAttribute("data-ms-report", t("rp_entry")); rpAsk.hidden = false; }

  applyMask();
  const shared = parseShare(location.hash, PROBES.map(p => p.id));
  if (shared && shared.exits.length && !EMBED) showShared(shared);
  else if (/^#r=/.test(location.hash) && !EMBED) {
    // a result link that is cut short or from a format this page doesn't know: say so, and test only when asked
    S.badLink = true; document.documentElement.setAttribute("data-bad-link", "");
    $("#sharedTxt").textContent = t("bad_link");
    $("#run span").textContent = t("test_mine"); $("#run").disabled = false;
  }
  else { document.documentElement.removeAttribute("data-shared"); run(); }
})();
