import type { Detail } from "../contracts/index.ts";

export function detailElement(detail: Detail, close: () => void) {
  const article = document.createElement("article");
  const root = article.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    ":host{display:block;font:17px/1.9 system-ui,sans-serif;color:#24312e}button{font:inherit;font-size:13px;color:#6c7972;background:none;border:0;padding:0;cursor:pointer}h1{font-size:38px;line-height:1.3;margin:24px 0 36px}img,svg{max-width:100%}table{width:100%;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #ddd}h2,h3{line-height:1.4}";
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
