// 同一座灯塔的七种画风：上面一排可选，画面原地淡入淡出；下面写着这种画风的名字、
// 特点，以及它自带的一套配色和字体。没人点的时候自己一种一种换过去，点过一次就停下。
const { width: w, height: h, data: d, theme: t } = api;
const looks = d.looks || [];
const pic = { w: d.picture[0], h: d.picture[1] };
const left = (w - pic.w) / 2;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const root = api.html(`<style>
  .g{position:relative;width:${w}px;height:${h}px;font-family:${t.font};color:${t.ink}}
  .chips{position:absolute;left:0;right:0;top:0;height:46px;display:flex;justify-content:center;gap:8px}
  .chips button{position:relative;overflow:hidden;border:1.5px solid ${t.ink};background:${t.paper};color:${t.ink};border-radius:999px;padding:0 18px;height:38px;font:inherit;font-size:16px;cursor:pointer}
  .chips button[aria-pressed=true]{background:${t.ink};color:${t.paper}}
  .chips button i{position:absolute;left:0;bottom:0;height:3px;width:0;background:${t.accent}}
  .chips button[aria-pressed=true].auto i{animation:run ${d.every}s linear forwards}
  @keyframes run{to{width:100%}}
  .frame{position:absolute;left:${left - 14}px;top:${d.top - 14}px;width:${pic.w + 28}px;height:${pic.h + 28}px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08),0 12px 30px -10px rgba(20,30,50,.28);border:1px solid rgba(0,0,0,.06)}
  .stack{position:absolute;left:${left}px;top:${d.top}px;width:${pic.w}px;height:${pic.h}px;overflow:hidden}
  .stack img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.035);transition:opacity .9s ease,transform 3.6s ease-out}
  .stack img.on{opacity:1;transform:scale(1)}
  .cap{position:absolute;left:${left - 14}px;top:${d.top + pic.h + 34}px;width:${pic.w * 0.58}px}
  .cap b{display:block;font-size:30px;font-weight:600;letter-spacing:.02em;transition:font-family .3s}
  .cap span{display:block;margin-top:6px;font-size:16px;line-height:1.55;color:${t.muted}}
  .kit{position:absolute;right:${left - 14}px;top:${d.top + pic.h + 36}px;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
  .sw{display:flex;gap:6px}
  .sw i{width:26px;height:26px;border-radius:50%;border:1px solid rgba(0,0,0,.12);transition:background .6s}
  .type{display:flex;align-items:baseline;gap:10px;font-size:13px;color:${t.muted}}
  .type em{font-style:normal;font-size:26px;color:${t.ink}}
  .kit small{font-size:13px;color:${t.muted}}
</style>
<div class="g">
  <div class="chips">${looks.map((l, i) => `<button data-i="${i}" aria-pressed="false">${esc(l.name)}<i></i></button>`).join("")}</div>
  <div class="frame"></div>
  <div class="stack">${looks.map((l) => `<img alt="${esc(l.name)}" src="${api.materials[l.material]?.url ?? ""}">`).join("")}</div>
  <div class="cap"><b></b><span></span></div>
  <div class="kit"><small>${esc(d.paletteLabel)}</small><div class="sw">${"<i></i>".repeat(5)}</div><div class="type"><span class="fn"></span><em>${esc(d.sample)}</em></div></div>
</div>`);
const buttons = [...root.querySelectorAll(".chips button")];
const imgs = [...root.querySelectorAll(".stack img")];
const name = root.querySelector(".cap b"),
  note = root.querySelector(".cap span");
const swatches = [...root.querySelectorAll(".sw i")];
const sample = root.querySelector(".type em"),
  fontName = root.querySelector(".fn");
let at = -1,
  auto = !!d.every,
  timer;
const show = (i) => {
  at = i;
  const l = looks[i];
  buttons.forEach((b, j) => {
    b.setAttribute("aria-pressed", String(j === i));
    b.classList.toggle("auto", auto);
    // 重新开始进度条
    const bar = b.querySelector("i");
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = "";
  });
  imgs.forEach((im, j) => im.classList.toggle("on", j === i));
  name.textContent = l.name;
  name.style.fontFamily = l.font;
  note.textContent = l.note;
  l.palette.forEach((c, j) => swatches[j] && (swatches[j].style.background = c));
  sample.style.fontFamily = l.font;
  fontName.textContent = l.fontName;
};
const next = () => {
  clearTimeout(timer);
  if (!auto) return;
  timer = setTimeout(() => {
    show((at + 1) % looks.length);
    next();
  }, d.every * 1000);
};
buttons.forEach((b, i) =>
  b.addEventListener("click", () => {
    auto = false;
    clearTimeout(timer);
    show(i);
    void api.emit("change", { index: i, option: looks[i].name });
  }),
);
api.cleanup(() => clearTimeout(timer));
show(Math.max(0, Math.min(looks.length - 1, Number(d.value ?? 0))));
next();
return root;
