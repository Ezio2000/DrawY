// Rows of gentle waves for water: a sea, a river, a sound or light wave. They roll slowly
// unless `still` is set.
const d = api.data,
  t = api.theme;
const W = api.width,
  H = api.height;
const rows = Number(d.rows ?? 3),
  amp = Number(d.amplitude ?? Math.min(8, H / (rows * 3)));
const len = Number(d.wavelength ?? 64);
const color = d.color || t.accent2 || "#4a7fa8";
const w = Number(d.width ?? t.stroke ?? 1.6);
const wave = (y) => {
  let p = `M${-len} ${y}`;
  for (let x = -len; x < W + len; x += len)
    p += `q${len / 4} ${-amp} ${len / 2} 0t${len / 2} 0`;
  return p;
};
let out = `<style>@keyframes roll{to{transform:translateX(${len}px)}}.roll{animation:roll ${Number(d.period ?? 6)}s linear infinite}</style>`;
for (let i = 0; i < rows; i++) {
  const y = ((i + 0.5) / rows) * H;
  out += `<g class="${d.still ? "" : "roll"}" style="animation-duration:${Number(d.period ?? 6) * (1 + i * 0.35)}s"><path d="${wave(y)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-opacity="${1 - i * (0.5 / rows)}"/></g>`;
}
return api.svg(
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:hidden">${out}</svg>`,
);
