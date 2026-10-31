import type { Detail } from "../contracts/index.ts";

export function detailElement(detail: Detail, close: () => void) {
  const article = document.createElement("article");
  const root = article.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    ':host{display:block;max-width:680px;margin:0 auto;font:17px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",system-ui,sans-serif;color:#2b2a27;--serif:"Iowan Old Style","Palatino Linotype","Noto Serif SC","Songti SC",Georgia,serif}button{font:inherit;font-size:13px;color:#8b887f;background:none;border:0;padding:6px 0;cursor:pointer;transition:color .2s}button:hover{color:#c15f3c}h1,h2,h3{font-family:var(--serif);font-weight:500;color:#141413;letter-spacing:-.01em}h1{font-size:40px;line-height:1.25;margin:28px 0 40px}h2{font-size:24px;line-height:1.4;margin:2em 0 .6em}h3{font-size:19px;line-height:1.45;margin:1.6em 0 .4em}p{margin:0 0 1.1em}a{color:#b4532f}strong{color:#141413}img,svg{max-width:100%;border-radius:10px}blockquote{margin:1.4em 0;padding:0 0 0 18px;border-left:2px solid #d97757;color:#5e5d59}table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:10px 12px;border-bottom:1px solid #e6e3da;text-align:left}th{font-weight:600;color:#5e5d59}code{font:14px ui-monospace,Menlo,monospace;background:#f2f0ea;padding:2px 5px;border-radius:5px}';
  const back = document.createElement("button");
  back.textContent = "← 返回图中";
  back.onclick = close;
  const title = document.createElement("h1");
  title.textContent = detail.title;
  const body = document.createElement("div");
  body.innerHTML = detail.html;
  root.append(style, back, title, body);
  return article;
}
