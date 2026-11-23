// vendored from 1ms.dog/src/egress.js VERSION 5 (4a3258a) — the rules live there; do not edit them here.
// One exit verdict for the whole site. docs/egress-contract.md has the rules; this file implements them.
//
// Every page that says 「直连 / 代理」 calls classify() with the addresses it saw and the two anchors, instead of
// carrying its own regex, time-zone table and quorum. The file is dependency-free so a tool can vendor it:
//
//     cp 1ms.dog/src/egress.js <tool>/src/egress.js
//
// Vendored copies keep this header and add the canonical commit, so `grep VERSION` finds a stale copy.

export const VERSION = "5";

// The two anchors: our own probes, grey-cloud, answering GET /conn with the caller's address.
export const ANCHORS = {
  cn: "https://probe.dog.1msapp.com:9443/conn", // TX.SHA: a mainland domain not in any split-tunnel list
  intl: "https://probe.1ms.dog/conn",          // Tokyo: the same binary, the same answer shape
};

// Which anchor a probe's group is measured against. `udp` (STUN) is evidence only: it says what UDP sees,
// not what a destination sees, so it has no anchor of its own.
export const GROUP_ANCHOR = { cn: "cn", intl: "intl", ai: "intl", web: "intl", stack: "intl", udp: null };

// Data centres and VPN brands: the three tool lists merged. A match is a reading, not proof.
export const DC_RE = /amazon|google|microsoft|azure|digitalocean|vultr|choopa|constant company|linode|akamai|ovh|hetzner|oracle|alibaba|aliyun|tencent|huawei|m247|datacamp|cloudflare|leaseweb|contabo|hostinger|it7|racknerd|colocrossing|psychz|zenlayer|g-core|gcore|hostwinds|scaleway|ionos|kamatera|upcloud|bandwagon|dmit|cogent|quadranet|servers\.com|packet|equinix|fastly|cdn77|datapacket|tzulo|hostdare|greencloud|nexeon|frantech|buyvm|ucloud|kingsoft|baidu cloud|bytedance|volcano|fastnet data|hosting|\bvps\b|data ?cent/i;
export const DC_ASN = new Set([16509, 14618, 15169, 396982, 8075, 8068, 13335, 209242, 54113, 45102, 37963, 45090, 132203, 55990, 14061, 20473, 63949, 16276, 24940, 31898, 9009, 212238, 20940, 19527]);
export const VPN_RE = /mullvad|proton ?vpn|proton ag|\bnordvpn\b|expressvpn|surfshark|private internet access|\bpia\b|windscribe|ipvanish|cyberghost|purevpn|vyprvpn|tunnelbear|hide\.?me|azirevpn|perfect privacy|\bivpn\b|\bovpn\b|airvpn|torguard|hotspot shield|zenmate|privatevpn|ivacy|atlas vpn|mozilla vpn|hide my ass|\bhma\b/i;

// Countries whose AI services refuse a visitor. Kept here so every page agrees.
export const AI_BLOCKED = new Set(["CN", "HK", "MO", "RU", "IR", "KP", "SY", "CU", "BY"]);

// The time zones the CN split-tunnel logic needs, plus the majors. A caller may pass its own `tzCountry`.
// Generated from the IANA tz database (zone.tab and backward links): time zone → ISO country code.
// Backward links follow identical clock data, not geography, so the places whose link target is on another
// continent are corrected by hand below: Iceland IS, Timbuktu ML, Asmera ER, Virgin VI, Ponape/Truk/Yap FM,
// South_Pole AQ, Coral_Harbour CA.
export const TZ_CC = {"Africa/Abidjan":"CI", "Africa/Accra":"CI", "Africa/Addis_Ababa":"KE", "Africa/Algiers":"DZ", "Africa/Asmara":"KE", "Africa/Asmera":"ER", "Africa/Bamako":"CI", "Africa/Bangui":"NG", "Africa/Banjul":"CI", "Africa/Bissau":"GW", "Africa/Blantyre":"MZ", "Africa/Brazzaville":"NG", "Africa/Bujumbura":"MZ", "Africa/Cairo":"EG", "Africa/Casablanca":"MA", "Africa/Ceuta":"ES", "Africa/Conakry":"CI", "Africa/Dakar":"CI", "Africa/Dar_es_Salaam":"KE", "Africa/Djibouti":"KE", "Africa/Douala":"NG", "Africa/El_Aaiun":"EH", "Africa/Freetown":"CI", "Africa/Gaborone":"MZ", "Africa/Harare":"MZ", "Africa/Johannesburg":"ZA", "Africa/Juba":"SS", "Africa/Kampala":"KE", "Africa/Khartoum":"SD", "Africa/Kigali":"MZ", "Africa/Kinshasa":"NG", "Africa/Lagos":"NG", "Africa/Libreville":"NG", "Africa/Lome":"CI", "Africa/Luanda":"NG", "Africa/Lubumbashi":"MZ", "Africa/Lusaka":"MZ", "Africa/Malabo":"NG", "Africa/Maputo":"MZ", "Africa/Maseru":"ZA", "Africa/Mbabane":"ZA", "Africa/Mogadishu":"KE", "Africa/Monrovia":"LR", "Africa/Nairobi":"KE", "Africa/Ndjamena":"TD", "Africa/Niamey":"NG", "Africa/Nouakchott":"CI", "Africa/Ouagadougou":"CI", "Africa/Porto-Novo":"NG", "Africa/Sao_Tome":"ST", "Africa/Timbuktu":"ML", "Africa/Tripoli":"LY", "Africa/Tunis":"TN", "Africa/Windhoek":"NA", "America/Adak":"US", "America/Anchorage":"US", "America/Anguilla":"PR", "America/Antigua":"PR", "America/Araguaina":"BR", "America/Argentina/Buenos_Aires":"AR", "America/Argentina/Catamarca":"AR", "America/Argentina/ComodRivadavia":"AR", "America/Argentina/Cordoba":"AR", "America/Argentina/Jujuy":"AR", "America/Argentina/La_Rioja":"AR", "America/Argentina/Mendoza":"AR", "America/Argentina/Rio_Gallegos":"AR", "America/Argentina/Salta":"AR", "America/Argentina/San_Juan":"AR", "America/Argentina/San_Luis":"AR", "America/Argentina/Tucuman":"AR", "America/Argentina/Ushuaia":"AR", "America/Aruba":"PR", "America/Asuncion":"PY", "America/Atikokan":"PA", "America/Atka":"US", "America/Bahia":"BR", "America/Bahia_Banderas":"MX", "America/Barbados":"BB", "America/Belem":"BR", "America/Belize":"BZ", "America/Blanc-Sablon":"PR", "America/Boa_Vista":"BR", "America/Bogota":"CO", "America/Boise":"US", "America/Buenos_Aires":"AR", "America/Cambridge_Bay":"CA", "America/Campo_Grande":"BR", "America/Cancun":"MX", "America/Caracas":"VE", "America/Catamarca":"AR", "America/Cayenne":"GF", "America/Cayman":"PA", "America/Chicago":"US", "America/Chihuahua":"MX", "America/Ciudad_Juarez":"MX", "America/Coral_Harbour":"CA", "America/Cordoba":"AR", "America/Costa_Rica":"CR", "America/Coyhaique":"CL", "America/Creston":"US", "America/Cuiaba":"BR", "America/Curacao":"PR", "America/Danmarkshavn":"GL", "America/Dawson":"CA", "America/Dawson_Creek":"CA", "America/Denver":"US", "America/Detroit":"US", "America/Dominica":"PR", "America/Edmonton":"CA", "America/Eirunepe":"BR", "America/El_Salvador":"SV", "America/Ensenada":"MX", "America/Fort_Nelson":"CA", "America/Fort_Wayne":"US", "America/Fortaleza":"BR", "America/Glace_Bay":"CA", "America/Godthab":"GL", "America/Goose_Bay":"CA", "America/Grand_Turk":"TC", "America/Grenada":"PR", "America/Guadeloupe":"PR", "America/Guatemala":"GT", "America/Guayaquil":"EC", "America/Guyana":"GY", "America/Halifax":"CA", "America/Havana":"CU", "America/Hermosillo":"MX", "America/Indiana/Indianapolis":"US", "America/Indiana/Knox":"US", "America/Indiana/Marengo":"US", "America/Indiana/Petersburg":"US", "America/Indiana/Tell_City":"US", "America/Indiana/Vevay":"US", "America/Indiana/Vincennes":"US", "America/Indiana/Winamac":"US", "America/Indianapolis":"US", "America/Inuvik":"CA", "America/Iqaluit":"CA", "America/Jamaica":"JM", "America/Jujuy":"AR", "America/Juneau":"US", "America/Kentucky/Louisville":"US", "America/Kentucky/Monticello":"US", "America/Knox_IN":"US", "America/Kralendijk":"PR", "America/La_Paz":"BO", "America/Lima":"PE", "America/Los_Angeles":"US", "America/Louisville":"US", "America/Lower_Princes":"PR", "America/Maceio":"BR", "America/Managua":"NI", "America/Manaus":"BR", "America/Marigot":"PR", "America/Martinique":"MQ", "America/Matamoros":"MX", "America/Mazatlan":"MX", "America/Mendoza":"AR", "America/Menominee":"US", "America/Merida":"MX", "America/Metlakatla":"US", "America/Mexico_City":"MX", "America/Miquelon":"PM", "America/Moncton":"CA", "America/Monterrey":"MX", "America/Montevideo":"UY", "America/Montreal":"CA", "America/Montserrat":"PR", "America/Nassau":"CA", "America/New_York":"US", "America/Nipigon":"CA", "America/Nome":"US", "America/Noronha":"BR", "America/North_Dakota/Beulah":"US", "America/North_Dakota/Center":"US", "America/North_Dakota/New_Salem":"US", "America/Nuuk":"GL", "America/Ojinaga":"MX", "America/Panama":"PA", "America/Pangnirtung":"CA", "America/Paramaribo":"SR", "America/Phoenix":"US", "America/Port-au-Prince":"HT", "America/Port_of_Spain":"PR", "America/Porto_Acre":"BR", "America/Porto_Velho":"BR", "America/Puerto_Rico":"PR", "America/Punta_Arenas":"CL", "America/Rainy_River":"CA", "America/Rankin_Inlet":"CA", "America/Recife":"BR", "America/Regina":"CA", "America/Resolute":"CA", "America/Rio_Branco":"BR", "America/Rosario":"AR", "America/Santa_Isabel":"MX", "America/Santarem":"BR", "America/Santiago":"CL", "America/Santo_Domingo":"DO", "America/Sao_Paulo":"BR", "America/Scoresbysund":"GL", "America/Shiprock":"US", "America/Sitka":"US", "America/St_Barthelemy":"PR", "America/St_Johns":"CA", "America/St_Kitts":"PR", "America/St_Lucia":"PR", "America/St_Thomas":"PR", "America/St_Vincent":"PR", "America/Swift_Current":"CA", "America/Tegucigalpa":"HN", "America/Thule":"GL", "America/Thunder_Bay":"CA", "America/Tijuana":"MX", "America/Toronto":"CA", "America/Tortola":"PR", "America/Vancouver":"CA", "America/Virgin":"VI", "America/Whitehorse":"CA", "America/Winnipeg":"CA", "America/Yakutat":"US", "America/Yellowknife":"CA", "Antarctica/Casey":"AQ", "Antarctica/Davis":"AQ", "Antarctica/DumontDUrville":"PG", "Antarctica/Macquarie":"AU", "Antarctica/Mawson":"AQ", "Antarctica/McMurdo":"NZ", "Antarctica/Palmer":"AQ", "Antarctica/Rothera":"AQ", "Antarctica/South_Pole":"AQ", "Antarctica/Syowa":"SA", "Antarctica/Troll":"AQ", "Antarctica/Vostok":"AQ", "Arctic/Longyearbyen":"DE", "Asia/Aden":"SA", "Asia/Almaty":"KZ", "Asia/Amman":"JO", "Asia/Anadyr":"RU", "Asia/Aqtau":"KZ", "Asia/Aqtobe":"KZ", "Asia/Ashgabat":"TM", "Asia/Ashkhabad":"TM", "Asia/Atyrau":"KZ", "Asia/Baghdad":"IQ", "Asia/Bahrain":"QA", "Asia/Baku":"AZ", "Asia/Bangkok":"TH", "Asia/Barnaul":"RU", "Asia/Beirut":"LB", "Asia/Bishkek":"KG", "Asia/Brunei":"MY", "Asia/Calcutta":"IN", "Asia/Chita":"RU", "Asia/Choibalsan":"MN", "Asia/Chongqing":"CN", "Asia/Chungking":"CN", "Asia/Colombo":"LK", "Asia/Dacca":"BD", "Asia/Damascus":"SY", "Asia/Dhaka":"BD", "Asia/Dili":"TL", "Asia/Dubai":"AE", "Asia/Dushanbe":"TJ", "Asia/Famagusta":"CY", "Asia/Gaza":"PS", "Asia/Harbin":"CN", "Asia/Hebron":"PS", "Asia/Ho_Chi_Minh":"VN", "Asia/Hong_Kong":"HK", "Asia/Hovd":"MN", "Asia/Irkutsk":"RU", "Asia/Istanbul":"TR", "Asia/Jakarta":"ID", "Asia/Jayapura":"ID", "Asia/Jerusalem":"IL", "Asia/Kabul":"AF", "Asia/Kamchatka":"RU", "Asia/Karachi":"PK", "Asia/Kashgar":"CN", "Asia/Kathmandu":"NP", "Asia/Katmandu":"NP", "Asia/Khandyga":"RU", "Asia/Kolkata":"IN", "Asia/Krasnoyarsk":"RU", "Asia/Kuala_Lumpur":"SG", "Asia/Kuching":"MY", "Asia/Kuwait":"SA", "Asia/Macao":"MO", "Asia/Macau":"MO", "Asia/Magadan":"RU", "Asia/Makassar":"ID", "Asia/Manila":"PH", "Asia/Muscat":"AE", "Asia/Nicosia":"CY", "Asia/Novokuznetsk":"RU", "Asia/Novosibirsk":"RU", "Asia/Omsk":"RU", "Asia/Oral":"KZ", "Asia/Phnom_Penh":"TH", "Asia/Pontianak":"ID", "Asia/Pyongyang":"KP", "Asia/Qatar":"QA", "Asia/Qostanay":"KZ", "Asia/Qyzylorda":"KZ", "Asia/Rangoon":"MM", "Asia/Riyadh":"SA", "Asia/Saigon":"VN", "Asia/Sakhalin":"RU", "Asia/Samarkand":"UZ", "Asia/Seoul":"KR", "Asia/Shanghai":"CN", "Asia/Singapore":"SG", "Asia/Srednekolymsk":"RU", "Asia/Taipei":"TW", "Asia/Tashkent":"UZ", "Asia/Tbilisi":"GE", "Asia/Tehran":"IR", "Asia/Tel_Aviv":"IL", "Asia/Thimbu":"BT", "Asia/Thimphu":"BT", "Asia/Tokyo":"JP", "Asia/Tomsk":"RU", "Asia/Ujung_Pandang":"ID", "Asia/Ulaanbaatar":"MN", "Asia/Ulan_Bator":"MN", "Asia/Urumqi":"CN", "Asia/Ust-Nera":"RU", "Asia/Vientiane":"TH", "Asia/Vladivostok":"RU", "Asia/Yakutsk":"RU", "Asia/Yangon":"MM", "Asia/Yekaterinburg":"RU", "Asia/Yerevan":"AM", "Atlantic/Azores":"PT", "Atlantic/Bermuda":"BM", "Atlantic/Canary":"ES", "Atlantic/Cape_Verde":"CV", "Atlantic/Faeroe":"FO", "Atlantic/Faroe":"FO", "Atlantic/Jan_Mayen":"DE", "Atlantic/Madeira":"PT", "Atlantic/Reykjavik":"CI", "Atlantic/South_Georgia":"GS", "Atlantic/St_Helena":"CI", "Atlantic/Stanley":"FK", "Australia/ACT":"AU", "Australia/Adelaide":"AU", "Australia/Brisbane":"AU", "Australia/Broken_Hill":"AU", "Australia/Canberra":"AU", "Australia/Currie":"AU", "Australia/Darwin":"AU", "Australia/Eucla":"AU", "Australia/Hobart":"AU", "Australia/LHI":"AU", "Australia/Lindeman":"AU", "Australia/Lord_Howe":"AU", "Australia/Melbourne":"AU", "Australia/NSW":"AU", "Australia/North":"AU", "Australia/Perth":"AU", "Australia/Queensland":"AU", "Australia/South":"AU", "Australia/Sydney":"AU", "Australia/Tasmania":"AU", "Australia/Victoria":"AU", "Australia/West":"AU", "Australia/Yancowinna":"AU", "Brazil/Acre":"BR", "Brazil/DeNoronha":"BR", "Brazil/East":"BR", "Brazil/West":"BR", "CET":"BE", "Canada/Atlantic":"CA", "Canada/Central":"CA", "Canada/Eastern":"CA", "Canada/Mountain":"CA", "Canada/Newfoundland":"CA", "Canada/Pacific":"CA", "Canada/Saskatchewan":"CA", "Canada/Yukon":"CA", "Chile/Continental":"CL", "Chile/EasterIsland":"CL", "Cuba":"CU", "EET":"GR", "EST":"PA", "Egypt":"EG", "Eire":"IE", "Etc/GMT":"UN", "Etc/GMT+0":"UN", "Etc/GMT-0":"UN", "Etc/GMT0":"UN", "Etc/UTC":"UN", "Etc/Universal":"UN", "Etc/Zulu":"UN", "Europe/Amsterdam":"BE", "Europe/Andorra":"AD", "Europe/Astrakhan":"RU", "Europe/Athens":"GR", "Europe/Belfast":"GB", "Europe/Belgrade":"RS", "Europe/Berlin":"DE", "Europe/Bratislava":"CZ", "Europe/Brussels":"BE", "Europe/Bucharest":"RO", "Europe/Budapest":"HU", "Europe/Busingen":"CH", "Europe/Chisinau":"MD", "Europe/Copenhagen":"DE", "Europe/Dublin":"IE", "Europe/Gibraltar":"GI", "Europe/Guernsey":"GB", "Europe/Helsinki":"FI", "Europe/Isle_of_Man":"GB", "Europe/Istanbul":"TR", "Europe/Jersey":"GB", "Europe/Kaliningrad":"RU", "Europe/Kiev":"UA", "Europe/Kirov":"RU", "Europe/Kyiv":"UA", "Europe/Lisbon":"PT", "Europe/Ljubljana":"RS", "Europe/London":"GB", "Europe/Luxembourg":"BE", "Europe/Madrid":"ES", "Europe/Malta":"MT", "Europe/Mariehamn":"FI", "Europe/Minsk":"BY", "Europe/Monaco":"FR", "Europe/Moscow":"RU", "Europe/Nicosia":"CY", "Europe/Oslo":"DE", "Europe/Paris":"FR", "Europe/Podgorica":"RS", "Europe/Prague":"CZ", "Europe/Riga":"LV", "Europe/Rome":"IT", "Europe/Samara":"RU", "Europe/San_Marino":"IT", "Europe/Sarajevo":"RS", "Europe/Saratov":"RU", "Europe/Simferopol":"UA", "Europe/Skopje":"RS", "Europe/Sofia":"BG", "Europe/Stockholm":"DE", "Europe/Tallinn":"EE", "Europe/Tirane":"AL", "Europe/Tiraspol":"MD", "Europe/Ulyanovsk":"RU", "Europe/Uzhgorod":"UA", "Europe/Vaduz":"CH", "Europe/Vatican":"IT", "Europe/Vienna":"AT", "Europe/Vilnius":"LT", "Europe/Volgograd":"RU", "Europe/Warsaw":"PL", "Europe/Zagreb":"RS", "Europe/Zaporozhye":"UA", "Europe/Zurich":"CH", "GB":"GB", "GB-Eire":"GB", "GMT":"UN", "GMT0":"UN", "Greenwich":"UN", "HST":"US", "Hongkong":"HK", "Iceland":"IS", "Indian/Antananarivo":"KE", "Indian/Chagos":"IO", "Indian/Christmas":"TH", "Indian/Cocos":"MM", "Indian/Comoro":"KE", "Indian/Kerguelen":"MV", "Indian/Mahe":"AE", "Indian/Maldives":"MV", "Indian/Mauritius":"MU", "Indian/Mayotte":"KE", "Indian/Reunion":"AE", "Iran":"IR", "Israel":"IL", "Jamaica":"JM", "Japan":"JP", "Kwajalein":"MH", "Libya":"LY", "MET":"BE", "MST":"US", "Mexico/BajaNorte":"MX", "Mexico/BajaSur":"MX", "Mexico/General":"MX", "NZ":"NZ", "NZ-CHAT":"NZ", "Navajo":"US", "PRC":"CN", "Pacific/Apia":"WS", "Pacific/Auckland":"NZ", "Pacific/Bougainville":"PG", "Pacific/Chatham":"NZ", "Pacific/Chuuk":"PG", "Pacific/Easter":"CL", "Pacific/Efate":"VU", "Pacific/Enderbury":"KI", "Pacific/Fakaofo":"TK", "Pacific/Fiji":"FJ", "Pacific/Funafuti":"KI", "Pacific/Galapagos":"EC", "Pacific/Gambier":"PF", "Pacific/Guadalcanal":"SB", "Pacific/Guam":"GU", "Pacific/Honolulu":"US", "Pacific/Johnston":"US", "Pacific/Kanton":"KI", "Pacific/Kiritimati":"KI", "Pacific/Kosrae":"FM", "Pacific/Kwajalein":"MH", "Pacific/Majuro":"KI", "Pacific/Marquesas":"PF", "Pacific/Midway":"AS", "Pacific/Nauru":"NR", "Pacific/Niue":"NU", "Pacific/Norfolk":"NF", "Pacific/Noumea":"NC", "Pacific/Pago_Pago":"AS", "Pacific/Palau":"PW", "Pacific/Pitcairn":"PN", "Pacific/Pohnpei":"SB", "Pacific/Ponape":"FM", "Pacific/Port_Moresby":"PG", "Pacific/Rarotonga":"CK", "Pacific/Saipan":"GU", "Pacific/Samoa":"AS", "Pacific/Tahiti":"PF", "Pacific/Tarawa":"KI", "Pacific/Tongatapu":"TO", "Pacific/Truk":"FM", "Pacific/Wake":"KI", "Pacific/Wallis":"KI", "Pacific/Yap":"FM", "Poland":"PL", "Portugal":"PT", "ROC":"TW", "ROK":"KR", "Singapore":"SG", "Turkey":"TR", "US/Alaska":"US", "US/Aleutian":"US", "US/Arizona":"US", "US/Central":"US", "US/East-Indiana":"US", "US/Eastern":"US", "US/Hawaii":"US", "US/Indiana-Starke":"US", "US/Michigan":"US", "US/Mountain":"US", "US/Pacific":"US", "US/Samoa":"AS", "UTC":"UN", "Universal":"UN", "W-SU":"RU", "WET":"PT", "Zulu":"UN"};

export const tzCountry = tz => TZ_CC[tz] || null;

// The network an address stands for: ASN when known, else /16 (IPv4) or /64 (IPv6).
export function netOf(ip) {
  if (!ip) return "";
  if (ip.includes(":")) {
    const full = ip.split("::");
    const head = full[0] ? full[0].split(":") : [];
    const tail = full.length > 1 && full[1] ? full[1].split(":") : [];
    const groups = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail].slice(0, 4);
    return groups.map(g => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
  }
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}./16` : ip;
}

const mostSeen = list => {
  const n = new Map();
  for (const x of list) n.set(x, (n.get(x) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
};

// answers: [{ id, group, ip, org, asn, family }]
// anchors: { cn: "<ip>", intl: "<ip>" } (missing when a probe could not answer)
// Returns exits in a stable order: direct before proxy, then by how many probes saw them.
export function groupExits(answers) {
  const by = new Map();
  for (const a of answers || []) {
    if (!a || !a.ip || a.ip === "::" || a.ip === "0.0.0.0") continue;
    const key = a.asn ? `as${a.asn}` : netOf(a.ip);
    let e = by.get(key);
    if (!e) by.set(key, e = { key, ip: a.ip, org: "", asn: null, groups: new Set(), seenBy: [], v4: null, v6: null });
    if (a.org && !e.org) e.org = a.org;
    if (a.asn && !e.asn) e.asn = Number(a.asn) || a.asn;
    e.groups.add(a.group);
    e.seenBy.push(a.id);
    if (a.ip.includes(":")) e.v6 ||= a.ip; else e.v4 ||= a.ip;
  }
  return [...by.values()];
}

// Which anchor an exit follows: "cn", "intl", "both", "other" (none, with anchors in hand) or
// "unknown-path" (the anchors that would have said are missing).
export function pathOf(exit, anchors = {}) {
  const want = [...new Set([...exit.groups].map(g => GROUP_ANCHOR[g]).filter(Boolean))];
  const hit = want.filter(a => anchors[a] && anchors[a] === exit.ip);
  if (hit.length === 2) return "both";
  if (hit.length === 1) return hit[0];
  const later = Object.keys(anchors).filter(k => anchors[k] && anchors[k] === exit.ip && !want.includes(k));
  if (later.length) return later[0];
  return want.some(a => anchors[a]) ? "other" : "unknown-path";
}

export function kindOf(exit, { warp = "" } = {}) {
  const org = exit.org || "";
  if (VPN_RE.test(org)) return { kind: "proxy", why: "vpn" };
  // Cloudflare's own ASN is a proxy exit either way; WARP on is the more precise reason, so it comes first.
  if (Number(exit.asn) === 13335 && warp && warp !== "off") return { kind: "proxy", why: "warp" };
  if (DC_ASN.has(Number(exit.asn)) || DC_RE.test(org)) return { kind: "proxy", why: "dc" };
  if (!org && !exit.asn) return { kind: "unknown", why: "no-geo" };
  return { kind: "direct", why: "residential" };
}

// classify(): the one entry point.
//   answers  see groupExits()
//   anchors  { cn, intl } addresses from /conn, each optional
//   warp     "on" | "off" | "" from the page's own trace
//   tz       IANA zone, for the single-exit reasons
//   cc       the exit's country code, when the page knows it
//   mode     "multi" (default) or "single"
export function classify({ answers = [], anchors = {}, warp = "", tz = "", cc = "", rtc = "", mode = "multi" } = {}) {
  const exits = groupExits(answers).map(e => ({
    ...e,
    groups: [...e.groups],
    seenBy: [...new Set(e.seenBy)],
    path: pathOf(e, anchors),
    ...kindOf(e, { warp }),
  }));
  exits.sort((a, b) => (a.kind === "proxy") - (b.kind === "proxy") || b.seenBy.length - a.seenBy.length || String(a.key).localeCompare(String(b.key)));
  const pick = g => exits.find(e => e.groups.includes(g));
  const cnExit = pick("cn"), intlExit = pick("intl") || pick("ai") || pick("web") || pick("stack");
  const reasons = [];

  if (tz && cc) {
    const home = tzCountry(tz);
    const same = home === cc || (home === "CN" && (cc === "HK" || cc === "MO"));
    if (home && cc !== "UN" && !same) reasons.push({ k: "r_tz", home, cc });
  }

  if (mode === "single") {
    const primary = intlExit || cnExit || exits[0] || null;
    if (!primary) return { exits, primary: null, verdict: "unknown", reasons };
    if (primary.kind === "proxy" && primary.why !== "anchor") {
      reasons.unshift({ k: primary.why === "vpn" ? "r_vpn" : primary.why === "warp" ? "r_warp" : "r_dc", org: primary.org, asn: primary.asn });
    }
    // Single-stack probes are compared with the reference exit of their own family: a dual-stack line
    // has a v4 and a v6 address and they are never equal, so comparing the two families to each other
    // would call every dual-stack visitor a proxy.
    const famRef = { 4: primary.v4, 6: primary.v6 };
    for (const a of answers) {
      if (!a || !a.stack || !a.ip) continue;
      const fam = a.ip.includes(":") ? 6 : 4;
      const ref = famRef[fam];
      if (ref && netOf(ref) !== netOf(a.ip)) reasons.push({ k: "r_fam", a: a.ip, b: ref });
    }
    if (rtc && primary.ip && rtc.includes(":") === primary.ip.includes(":") && netOf(rtc) !== netOf(primary.ip)) {
      reasons.push({ k: "r_rtc", ip: rtc });
    }
    const verdict = primary.kind === "proxy" || reasons.some(r => r.k === "r_tz" || r.k === "r_rtc" || r.k === "r_fam")
      ? "proxy" : primary.kind === "unknown" ? "unknown" : "direct";
    return { exits, primary, verdict, reasons };
  }

  // multi: leak > ai > split > the reference exit's kind
  const udp = exits.find(e => e.groups.includes("udp"));
  const ref = intlExit || cnExit;
  if (udp && udp.kind === "direct" && ref && ref.kind === "proxy") return { exits, verdict: "leak", reasons };
  const any4 = exits.find(e => e.v4 && e.kind !== "unknown"), any6 = exits.find(e => e.v6 && e.kind !== "unknown");
  if (any4 && any6 && any4.kind === "proxy" && any6.kind === "direct") return { exits, verdict: "leak", reasons };
  if (cnExit && intlExit && cnExit.key !== intlExit.key) return { exits, verdict: "split", reasons };
  return { exits, verdict: !ref ? "unknown" : ref.kind === "proxy" ? "proxy" : ref.kind === "unknown" ? "unknown" : "direct", reasons };
}

// The lag page's hint: the device's time zone is somewhere else than the exit. Only a hint.
export function hint({ tz = "", exitCC = "", tzCountry: tzc = tzCountry } = {}) {
  const home = tzc(tz);
  if (!home || !exitCC) return null;
  if (home === exitCC || (home === "CN" && (exitCC === "HK" || exitCC === "MO"))) return null;
  return { home, exit: exitCC };
}
