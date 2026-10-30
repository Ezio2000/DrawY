import type { Work } from "../contracts/index.ts";
export function documentFor(work: Work, sceneId: string) {
  const data = JSON.stringify({ work, sceneId }).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#stage{width:100%;height:100%;margin:0;overflow:hidden;background:#faf9f5}body{font-family:system-ui}</style></head><body><div id="stage"></div><script>window.drawyData=${data};</script><script src="/runtime/runtime.js"></script></body></html>`;
}
