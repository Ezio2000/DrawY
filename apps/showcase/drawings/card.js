// 一张说明卡片：上面一行小字，一个标题，一段话，底下一行提示。每次换内容都轻轻淡入。
const { width: w, height: h, data: d, theme: t } = api;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const root = api.html(`<style>
  .c{box-sizing:border-box;width:${w}px;padding:8px 0 10px 30px;border-left:3px solid ${d.color || t.accent};font-family:${t.font};color:${t.ink};animation:in .5s ease both}
  .k{font-size:16px;letter-spacing:.08em;color:${d.color || t.accent};font-weight:600}
  h3{margin:10px 0 14px;font-size:${d.size || 40}px;line-height:1.2;font-weight:600}
  p{margin:0;font-size:${d.textSize || 20}px;line-height:1.7;color:${t.ink}}
  .f{margin-top:20px;font-size:16px;color:${t.muted}}
  .n{display:flex;gap:6px;margin-top:22px}.n i{width:22px;height:4px;border-radius:2px;background:${t.muted};opacity:.3}.n i.on{background:${d.color || t.accent};opacity:1}
  @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
</style><div class="c">
  ${d.kicker ? `<div class="k">${esc(d.kicker)}</div>` : ""}
  <h3>${esc(d.title)}</h3>
  <p>${esc(d.text)}</p>
  ${d.total ? `<div class="n">${Array.from({ length: d.total }, (_, i) => `<i class="${i === d.index ? "on" : ""}"></i>`).join("")}</div>` : ""}
  ${d.foot ? `<div class="f">${esc(d.foot)}</div>` : ""}
</div>`);
return root;
