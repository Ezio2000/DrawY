// A library picture set on the page: fitted by its visible content and resting on the
// bottom of the module, optionally grounded by a soft shadow, with its caption directly
// under the picture rather than under the module.
const d = api.data, t = api.theme;
const W = api.width, H = api.height;
const info = api.materials[d.material];
if (!info) throw Error(`素材 ${d.material} 不在作品中`);
const size = Number(d.captionSize ?? 15);
const caption = d.caption ? String(d.caption) : "";
const below = caption ? size * 1.8 : 0;
const shade = d.shadow ? Math.max(6, H * 0.05) : 0;
const room = H - below - shade * 0.6;
const k = (d.fit === "cover" ? Math.max : Math.min)(W / info.width, room / info.height);
const pw = Math.min(W, info.width * k), ph = Math.min(room, info.height * k);
const top = room - ph;
const root = api.html(`<div style="position:relative;width:${W}px;height:${H}px"></div>`).firstElementChild;
if (shade) {
  const s = document.createElement("div");
  s.style.cssText = `position:absolute;left:${(W - pw * 0.8) / 2}px;width:${pw * 0.8}px;top:${room - shade * 0.55}px;height:${shade}px;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.2),rgba(0,0,0,.07) 60%,transparent)`;
  root.append(s);
}
const picture = api.material(d.material, { width: pw, height: ph, fit: d.fit ?? "contain" });
picture.style.position = "absolute";
picture.style.left = (W - pw) / 2 + "px";
picture.style.top = top + "px";
root.append(picture);
if (caption) {
  const c = document.createElement("div");
  c.textContent = caption;
  c.style.cssText = `position:absolute;left:-20%;right:-20%;top:${room + shade * 0.4 + size * 0.3}px;text-align:center;font-size:${size}px;line-height:1.3;color:${d.color || t.ink || "#222"};white-space:nowrap`;
  root.append(c);
}
return root;
