// A soft contact shadow that sets an object on the ground instead of floating it. Place it
// as a flat module just under the object's base, about as wide as the object.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const o = Number(d.opacity ?? 0.22);
const color = d.color || t.ink || "#000";
const id = "g" + Math.random().toString(36).slice(2, 8);
return api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${o}"/><stop offset="0.55" stop-color="${color}" stop-opacity="${o * 0.5}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2}" ry="${H / 2}" fill="url(#${id})"/>
</svg>`);
