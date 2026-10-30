import type { Page } from "../contracts/index.ts";
export function documentFor(page: Page, readOnly = false) {
  const config = JSON.stringify({
    diagrams: page.diagrams,
    readOnly,
  }).replaceAll("<", "\\u003c");
  const bootstrap = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{overflow-x:hidden}body{margin:0}img{max-width:100%}[data-drawy-selected]{outline:2px solid #d97757;outline-offset:4px}[data-drawy-open]{cursor:pointer}[data-drawy-diagram] svg{max-width:100%;height:auto}</style><script>window.drawyData=${config};window.drawyErrors=[];window.drawy={pending:[],waitUntil(p){this.pending.push(Promise.resolve(p))}};<\/script><script defer src="/runtime/runtime.js"><\/script>`;
  return /<head[^>]*>/i.test(page.html)
    ? page.html.replace(/<head[^>]*>/i, (m) => m + bootstrap)
    : `<!doctype html><html><head>${bootstrap}</head><body>${page.html}</body></html>`;
}
