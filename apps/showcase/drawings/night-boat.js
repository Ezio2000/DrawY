// 一条小帆船：帆被月光照亮，船舱里亮着一盏灯，随着浪轻轻起伏，正朝灯塔驶去。
const { width: w, height: h } = api;
const svg = api.svg(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="overflow:visible">
  <defs>
    <linearGradient id="sail" x1="0" x2="1"><stop offset="0" stop-color="#e9edfb"/><stop offset="1" stop-color="#8c97bd"/></linearGradient>
    <linearGradient id="jib" x1="0" x2="1"><stop offset="0" stop-color="#c9d1ee"/><stop offset="1" stop-color="#6f7aa3"/></linearGradient>
    <radialGradient id="lit"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".9"/><stop offset="1" stop-color="#ffe2a0" stop-opacity="0"/></radialGradient>
  </defs>
  <g class="boat">
    <path d="M${w * 0.45} ${h * 0.08} V${h * 0.74}" stroke="#2b3150" stroke-width="2.4"/>
    <path d="M${w * 0.45} ${h * 0.11} L${w * 0.45} ${h * 0.7} L${w * 0.1} ${h * 0.7} Z" fill="url(#sail)"/>
    <path d="M${w * 0.47} ${h * 0.16} L${w * 0.84} ${h * 0.7} L${w * 0.47} ${h * 0.7} Z" fill="url(#jib)"/>
    <path d="M${w * 0.04} ${h * 0.74} H${w * 0.96} L${w * 0.82} ${h * 0.9} H${w * 0.17} Z" fill="#141a33"/>
    <path d="M${w * 0.04} ${h * 0.74} H${w * 0.96}" stroke="#a9b6e2" stroke-width="1.6"/>
    <rect x="${w * 0.3}" y="${h * 0.66}" width="${w * 0.26}" height="${h * 0.08}" fill="#1c2341"/>
    <rect x="${w * 0.35}" y="${h * 0.68}" width="${w * 0.06}" height="${h * 0.04}" fill="#ffd27a"/>
    <circle cx="${w * 0.38}" cy="${h * 0.7}" r="${w * 0.16}" fill="url(#lit)" opacity=".55"/>
  </g>
  <path class="wake" d="M${w * 0.82} ${h * 0.9} q${w * 0.15} ${h * 0.04} ${w * 0.35} ${h * 0.02} M${w * 0.15} ${h * 0.9} q${-w * 0.12} ${h * 0.03} ${-w * 0.3} ${h * 0.03}" stroke="#93a6dc" stroke-width="1.5" fill="none" opacity=".6"/>
</svg>`);
const boat = svg.querySelector(".boat");
api.animate(() => {
  const t = performance.now() / 1000;
  boat.setAttribute("transform", `translate(0 ${(2.5 * Math.sin(t * 1.3)).toFixed(2)}) rotate(${(2.2 * Math.sin(t * 1.3 - 0.8)).toFixed(2)} ${w / 2} ${h * 0.8})`);
});
return svg;
