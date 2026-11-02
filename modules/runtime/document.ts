import type { Work } from "../contracts/index.ts";
const json = (v: unknown) => JSON.stringify(v).replaceAll("<", "\\u003c");
export function documentFor(work: Work, sceneId: string) {
  const data = json({ work, sceneId });
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#stage{width:100%;height:100%;margin:0;overflow:hidden;background:#fff}body{font-family:system-ui}</style></head><body><div id="stage"></div><script>window.drawyData=${data};</script><script src="/runtime/runtime.js"></script></body></html>`;
}
const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** A work as one file that opens anywhere: the runtime and the pictures inside it, every
 * scene explorable, with a way back up from a subscene. Data a drawing reads online (map
 * layers) still comes from `origin`, the app it was exported from. */
export function standaloneDocument(
  work: Work,
  sceneId: string,
  runtime: string,
  origin: string,
  words: { back: string; credit: string },
) {
  const data = json({ work, sceneId });
  const titles = json(
    Object.fromEntries(
      Object.values(work.scenes).map((s) => [
        s.id,
        { title: s.parentId ? s.title : work.title, parent: s.parentId ?? null },
      ]),
    ),
  );
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(work.title)}</title><meta property="og:title" content="${escape(work.title)}"><style>
html,body,#stage{width:100%;height:100%;margin:0;overflow:hidden;background:#fff}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#141413}
#chrome{position:fixed;z-index:20;left:16px;top:14px;display:flex;align-items:center;gap:10px;font-size:14px}
#chrome button{display:none;padding:6px 12px;border:0;border-radius:999px;background:rgba(20,20,19,.06);font:inherit;cursor:pointer}
#chrome button:hover{background:rgba(20,20,19,.1)}
#chrome b{font-family:Georgia,"Songti SC",serif;font-weight:500;font-size:17px}
#credit{position:fixed;z-index:20;right:16px;bottom:12px;font-size:12px;color:#87867f}
#credit a{color:inherit}
</style></head><body><div id="chrome"><button id="up"></button><b id="title"></b></div><div id="stage"></div><div id="credit">${escape(words.credit)}</div>
<script>
window.drawyData=${data};
(function(){
var origin=${json(origin)},scenes=${titles},back=${json(words.back)};
var f=window.fetch;
window.fetch=function(u,o){if(typeof u==="string"&&u.charAt(0)==="/")u=origin+u;return f.call(this,u,o)};
function show(id){var s=scenes[id]||{};document.getElementById("title").textContent=s.title||"";var up=document.getElementById("up");var p=s.parent&&scenes[s.parent];up.style.display=p?"inline-block":"none";up.textContent=p?"← "+back+" "+p.title:"";up.onclick=function(){window.drawyOpen&&window.drawyOpen(s.parent)}}
addEventListener("drawy:scene",function(e){show(e.detail)});
show(window.drawyData.sceneId);
})();
</script>
<script>${runtime.replaceAll("</script", "<\\/script")}</script></body></html>`;
}
