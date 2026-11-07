import type { Detail } from "../contracts/index.ts";

export function detailElement(detail: Detail, close: () => void) {
  const article = document.createElement("article");
  const root = article.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    ':host{display:block;max-width:680px;margin:0 auto;font:17px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",system-ui,sans-serif;color:#22262b;--serif:"Iowan Old Style","Palatino Linotype","Noto Serif SC","Songti SC",Georgia,serif}button{font:inherit;font-size:13px;color:#70767f;background:none;border:0;padding:6px 0;cursor:pointer;transition:color .2s}button:hover{color:#1f50d6}h1,h2,h3{font-family:var(--serif);font-weight:500;color:#15181c;letter-spacing:-.01em}h1{font-size:40px;line-height:1.25;margin:28px 0 40px}h2{font-size:24px;line-height:1.4;margin:2em 0 .6em}h3{font-size:19px;line-height:1.45;margin:1.6em 0 .4em}p{margin:0 0 1.1em}a{color:#1f50d6}strong{color:#15181c}img,svg{max-width:100%;border-radius:10px}blockquote{margin:1.4em 0;padding:0 0 0 18px;border-left:2px solid #c2c7cd;color:#50565f}table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:10px 12px;border-bottom:1px solid #e6e8eb;text-align:left}th{font-weight:600;color:#50565f}code{font:14px ui-monospace,Menlo,monospace;background:#f0f1f3;padding:2px 5px;border-radius:5px}';
  const back = document.createElement("button");
  // The page's language; Chinese where it declares none, as the capture page does not.
  back.textContent = /^en/i.test(document.documentElement.lang)
    ? "← Back to the picture"
    : "← 返回图中";
  back.onclick = close;
  const title = document.createElement("h1");
  title.textContent = detail.title;
  const body = document.createElement("div");
  body.innerHTML = detail.html;
  root.append(style, back, title, body);
  return article;
}
