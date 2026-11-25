// The EgressLens Worker. Files in ./public are served as they are, before the Worker runs, except the HTML pages
// wrangler.toml lists in assets.run_worker_first: those pass through it so it can add the measurement points from the
// environment (docs/tool-contract.md §2). Nothing set → no tags, and the page leaves its own probes out instead of
// falling back to someone else's service.
//
//   <meta name="ms-anchors" content="cn=<base>;intl=<base>">          the two route anchors
//   <meta name="ms-egress"  content="stun=<host>:<port>,…;echo=<base>[,<base>];ws=<url>">
//                                                                     the port-and-protocol servers, echo in server
//                                                                     order (Tokyo, then the mainland one)
//
// The addresses are deploy data; this repository keeps only the parser and the ports. Set them with
// `npx wrangler secret put MS_ANCHORS` / `MS_EGRESS` (or `[vars]` for a self-hosted copy).

const ENDPOINTS = [["ms-anchors", "MS_ANCHORS"], ["ms-egress", "MS_EGRESS"]];
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// the tags the environment asks for, in a fixed order; empty when it sets neither
export function endpointTags(env = {}) {
  return ENDPOINTS.filter(([, key]) => env[key]).map(([name, key]) => [name, String(env[key])]);
}

export default {
  async fetch(req, env) {
    if (!env.ASSETS) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    const page = await env.ASSETS.fetch(req);
    const tags = endpointTags(env);
    if (!tags.length || req.method === "HEAD" || page.status !== 200) return page;
    if (!/text\/html/i.test(page.headers.get("content-type") || "")) return page;
    const html = tags.map(([name, value]) => `<meta name="${name}" content="${esc(value)}">`).join("");
    // right after <meta charset> (the contract keeps charset first) and before the page's own first script reads them
    return new HTMLRewriter().on("meta[charset]", { element: e => e.after(html, { html: true }) }).transform(page);
  },
};
