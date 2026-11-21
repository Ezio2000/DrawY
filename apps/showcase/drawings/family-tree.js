// 灯塔史蒂文森一家：四代人排成一棵向右长的树，每人一枚椭圆的剪影小像，圈的颜色
// 和地图上他造的灯塔一样；名字下面列着他留下的灯塔（或者书）。点一个人，左下的卡片
// 讲他的故事，他和祖辈之间的线亮起来；没人点时，自己一个一个往下讲。
const { width: W, height: H, data: d, theme: t } = api;
const people = d.people || [];
const ink = t.ink,
  muted = t.muted,
  paper = "#fbf8f2";
const R = 34;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const byId = Object.fromEntries(people.map((p) => [p.id, p]));
// 一个朝右的侧面剪影，按需要加胡子或长发；领口一抹白
const profile = (p) => {
  const head = `M-22 40 C-24 22 -15 13 -11 9 C-19 3 -21 -14 -15 -24 C-9 -35 7 -37 13 -29 C17 -23 16 -17 17 -12 L22 -4 L17 -2 C18 1 17 4 16 6 C15 9 13 12 9 13 C7 16 7 20 11 24 C19 28 27 33 32 40 Z`;
  const beard = p.beard ? `<path d="M17 2 C19 14 12 24 2 22 C-4 21 -8 14 -9 8 L-4 6 C0 10 6 12 9 12 Z" fill="${ink}"/>` : "";
  const hair = p.hair ? `<path d="M-15 -24 C-26 -10 -24 6 -16 16 C-12 12 -10 8 -11 6 C-18 -2 -19 -14 -15 -24 Z" fill="${ink}"/><path d="M15 -1 C13 1 11 1 9 0" stroke="${paper}" stroke-width="1.4" fill="none"/>` : "";
  return `<path d="${head}" fill="${ink}"/>${beard}${hair}<path d="M9 24 L16 31 L5 35 Z" fill="${paper}"/>`;
};
const nodeSvg = (p) => `<g class="person" data-id="${p.id}" transform="translate(${p.x} ${p.y})" data-interactive style="cursor:pointer">
    <rect x="-110" y="${-R - 6}" width="220" height="${R * 2 + 104}" fill="transparent"/>
    <ellipse class="halo" rx="${R + 9}" ry="${R + 13}" fill="${p.color}" opacity="0"/>
    <ellipse rx="${R}" ry="${R + 4}" fill="${paper}" stroke="${p.color}" stroke-width="4"/>
    <clipPath id="c-${p.id}"><ellipse rx="${R - 4}" ry="${R}"/></clipPath>
    <g clip-path="url(#c-${p.id})" transform="scale(${(R - 4) / 34})">${profile(p)}</g>
    <text y="${R + 30}" text-anchor="middle" font-size="20" font-weight="600" fill="${ink}">${esc(p.name)}</text>
    <text y="${R + 50}" text-anchor="middle" font-size="14" fill="${muted}">${esc(p.years)}</text>
    <foreignObject x="-108" y="${R + 56}" width="216" height="70"><div xmlns="http://www.w3.org/1999/xhtml" class="works" data-color="${p.color}">${esc(p.works)}</div></foreignObject>
  </g>`;
// 父子之间的折线：从父亲的右边出来，走到两列中间拐下去，再横着进孩子的左边
const elbow = (a, b) => {
  const mx = (a.x + b.x) / 2;
  return `M${a.x + R} ${a.y} H${mx} V${b.y} H${b.x - R - 4}`;
};
const links = people.filter((p) => p.parent).map((p) => ({ from: byId[p.parent], to: p }));
const svg = api.svg(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <g class="links" fill="none" stroke-linejoin="round">${links
    .map(({ from, to }) => `<path data-to="${to.id}" d="${elbow(from, to)}" stroke="${muted}" stroke-width="2"/>`)
    .join("")}</g>
  <g class="notes">${people
    .filter((p) => p.linkNote)
    .map((p) => {
      const a = byId[p.parent];
      return `<text x="${(a.x + p.x) / 2}" y="${p.y - 12}" text-anchor="middle" font-size="14" font-style="italic" fill="${muted}">${esc(p.linkNote)}</text>`;
    })
    .join("")}</g>
  <g class="people">${people.map(nodeSvg).join("")}</g>
  <g class="card" transform="translate(${d.card[0]} ${d.card[1]})">
    <rect class="bar" x="0" y="0" width="4" height="${d.card[3]}"/>
    <text class="cn" x="24" y="30" font-size="28" font-weight="600" fill="${ink}"></text>
    <text class="cy" x="24" y="58" font-size="16" fill="${muted}"></text>
    <foreignObject x="22" y="70" width="${d.card[2] - 24}" height="${d.card[3] - 70}"><div xmlns="http://www.w3.org/1999/xhtml" class="cs"></div></foreignObject>
  </g>
</svg>`);
svg.querySelectorAll(".works").forEach((el) =>
  Object.assign(el.style, { font: `15px/1.45 ${t.font}`, color: el.dataset.color, textAlign: "center" }),
);
const cs = svg.querySelector(".cs");
Object.assign(cs.style, { font: `19px/1.65 ${t.font}`, color: ink });
const cn = svg.querySelector(".cn"),
  cy = svg.querySelector(".cy"),
  bar = svg.querySelector(".bar");
const nodes = [...svg.querySelectorAll(".person")];
const paths = [...svg.querySelectorAll(".links path")];
// 一个人往上数的祖辈
const line = (id) => {
  const out = new Set();
  for (let p = byId[id]; p; p = byId[p.parent]) out.add(p.id);
  return out;
};
let at = -1,
  auto = true,
  timer;
const choose = (i) => {
  at = i;
  const p = people[i];
  const up = line(p.id);
  cn.textContent = p.name;
  cy.textContent = p.years;
  cs.textContent = p.story;
  bar.setAttribute("fill", p.color);
  // 竖条跟着这段话的长短走
  requestAnimationFrame(() => bar.setAttribute("height", String(Math.min(d.card[3], 78 + cs.scrollHeight))));
  nodes.forEach((n) => {
    const on = n.dataset.id === p.id;
    n.querySelector(".halo").setAttribute("opacity", on ? "0.22" : "0");
    n.setAttribute("opacity", up.has(n.dataset.id) ? "1" : "0.62");
  });
  paths.forEach((l) => {
    const on = up.has(l.dataset.to);
    l.setAttribute("stroke", on ? byId[l.dataset.to].color : muted);
    l.setAttribute("stroke-width", on ? "3.2" : "2");
    l.setAttribute("opacity", on ? "1" : "0.5");
  });
};
const next = () => {
  clearTimeout(timer);
  if (auto) timer = setTimeout(() => (choose((at + 1) % people.length), next()), d.every * 1000);
};
nodes.forEach((n, i) =>
  n.addEventListener("click", () => {
    auto = false;
    clearTimeout(timer);
    choose(i);
  }),
);
api.cleanup(() => clearTimeout(timer));
choose(Math.max(0, Number(d.value ?? 0)));
next();
return svg;
