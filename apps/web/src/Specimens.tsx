import type { CSSProperties, ReactNode } from "react";
import { useT } from "./i18n.tsx";

/* The drawings the blank sheet shows of what a request turns into, one for each request it
 * offers. Each is laid out as DrawY lays out its own: painted subjects from the library,
 * words and measures in ink, the relations and construction in the blue pencil, and the
 * mark a part that opens onto more carries on the canvas, shown open. They pencil
 * themselves in when they come up: the lines run along their length, the words come after
 * and the pictures develop from grey, each at its `--d`. */

export type SpecimenKind = "solar" | "model" | "kin";

/** One frame's worth of drawing: 640 by 440, the last 40 kept for the measure under it. */
const W = 640,
  H = 440;

const at = (seconds: number) => ({ "--d": seconds + "s" }) as CSSProperties;
const picture = (id: string, size = 256) => `/materials/thumbs/${id}?size=${size}`;
/** About how wide words are set, in the sheet's units: Chinese a full em, the rest a
 * little over half of one (Sofia Sans is narrow). */
function wide(text: string, size: number) {
  let n = 0;
  for (const c of text) n += c.charCodeAt(0) > 0x2e80 ? 1 : c === " " ? 0.28 : 0.55;
  return n * size;
}

/** Words on the drawing, set off the lines under them by a margin of paper. */
function Words({
  x,
  y,
  size = 12.5,
  weight,
  tone = "ink",
  anchor = "middle",
  d,
  children,
}: {
  x: number;
  y: number;
  size?: number;
  weight?: number;
  tone?: "ink" | "quiet" | "pencil";
  anchor?: "start" | "middle" | "end";
  d: number;
  children: ReactNode;
}) {
  return (
    <text
      x={x}
      y={y}
      data-tone={tone}
      data-fade
      textAnchor={anchor}
      style={{ ...at(d), fontSize: size, fontWeight: weight }}
    >
      {children}
    </text>
  );
}

/** A painted subject from the library, developing from grey. */
function Painted({
  id,
  x,
  y,
  w,
  h,
  d,
  size,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
  size?: number;
}) {
  return (
    <image
      href={picture(id, size)}
      x={x}
      y={y}
      width={w}
      height={h}
      preserveAspectRatio="xMidYMax meet"
      data-develop
      style={at(d)}
    />
  );
}

/** The mark a part that opens onto more carries on the canvas, open to say where it
 * leads; its corner sits on the part's top right as the canvas places it. */
function Opens({ x, y, label, d }: { x: number; y: number; label: string; d: number }) {
  const w = 29 + wide(label, 11.5);
  return (
    <g data-fade data-mark style={at(d)} transform={`translate(${x} ${y})`}>
      <rect width={w} height={21} rx={6} />
      <path d="M8.5 6.5h6v6M14.5 6.5l-7 7" />
      <text x={21} y={14.6}>
        {label}
      </text>
    </g>
  );
}

/** A measure between two points: the line, a 45° tick at each end, the figure on it. */
function Measure({
  from,
  to,
  y,
  label,
  d,
}: {
  from: number;
  to: number;
  y: number;
  label: string;
  d: number;
}) {
  const tick = (x: number) => `M${x - 4} ${y + 4}L${x + 4} ${y - 4}`;
  return (
    <g data-measure>
      <path d={`M${from} ${y}H${to}`} pathLength={1} data-line style={at(d)} />
      <path d={tick(from) + tick(to)} data-fade style={at(d + 0.3)} />
      <Words x={(from + to) / 2} y={y + 4.2} size={12} tone="pencil" weight={600} d={d + 0.35}>
        {label}
      </Words>
    </g>
  );
}

/** The solar system laid along one line out from the sun, each planet on its orbit with
 * its year, the first distance measured, and the Earth opening onto the seasons. */
function Solar() {
  const t = useT().opening.solar;
  const sun = { x: 100, y: 228 };
  const planets = [
    { id: "rock", r: 140, w: 22, h: 22 },
    { id: "earth", r: 225, w: 40, h: 40 },
    { id: "jupiter", r: 372, w: 76, h: 76 },
    { id: "saturn", r: 490, w: 96, h: 56 },
  ];
  const arc = (r: number) => {
    const turn = Math.min(64, (Math.asin(Math.min(1, 172 / r)) * 180) / Math.PI);
    const a = (turn * Math.PI) / 180;
    const x = sun.x + r * Math.cos(a),
      dy = r * Math.sin(a);
    return `M${x.toFixed(1)} ${(sun.y - dy).toFixed(1)}A${r} ${r} 0 0 1 ${x.toFixed(1)} ${(sun.y + dy).toFixed(1)}`;
  };
  const earth = sun.x + planets[1].r;
  return (
    <>
      {planets.map((p, i) => (
        <path key={p.id} d={arc(p.r)} pathLength={1} data-line data-orbit style={at(0.05 + i * 0.12)} />
      ))}
      <path d={`M${sun.x} ${sun.y}H${sun.x + 520}`} data-fade data-axis style={at(0.1)} />
      <Painted id="sun" x={0} y={130} w={200} h={196} d={0.15} />
      {planets.map((p, i) => {
        const x = sun.x + p.r;
        return (
          <g key={p.id}>
            <Painted id={p.id} x={x - p.w / 2} y={sun.y - p.h / 2} w={p.w} h={p.h} d={0.35 + i * 0.1} size={128} />
            <Words x={x} y={306} size={15} weight={650} d={0.75 + i * 0.06}>
              {t.planets[i]}
            </Words>
            <Words x={x} y={326} tone="quiet" d={0.85 + i * 0.06}>
              {t.periods[i]}
            </Words>
          </g>
        );
      })}
      <path
        d={`M${sun.x} 118V82M${earth} 200V82`}
        pathLength={1}
        data-line
        data-extension
        style={at(0.7)}
      />
      <Measure from={sun.x} to={earth} y={90} label={t.distance} d={0.8} />
      <Opens x={earth + 20 - 14} y={sun.y - 20 - 11} label={t.open} d={1.25} />
    </>
  );
}

/** A language model guessing the next word: the sentence so far in tiles, the last one
 * looking back over them (the heavier the line, the more it counts), the model, and how
 * it scores what may come next. */
function Model() {
  const t = useT().opening.model;
  const y = 318,
    h = 46,
    gap = 10;
  let x = 36;
  const tiles = t.tokens.map((word) => {
    const w = Math.max(48, Math.round(wide(word, 17) + 26));
    const tile = { word, x, w };
    x += w + gap;
    return tile;
  });
  const ghost = { x, w: 48 };
  const from = ghost.x + ghost.w / 2;
  const weights = [0.55, 0.35, 0.12, 0.7, 1];
  const longest = Math.max(...t.options.map(([w]) => wide(w, 15)));
  const card = { x: 446, y: 36, w: 176, h: 132 };
  const bar = card.x + 18 + longest + 12;
  const reach = card.x + card.w - 46 - bar;
  const brain = { x: 432, y: 200, w: 92, h: 86 };
  const far = tiles[0].x + tiles[0].w / 2;
  return (
    <>
      {tiles.map((tile, i) => {
        const to = tile.x + tile.w / 2,
          lift = 0.42 * (from - to),
          w = weights[i];
        return (
          <path
            key={i}
            d={`M${from} ${y - 2}Q${(from + to) / 2} ${y - lift} ${to} ${y - 2}`}
            pathLength={1}
            data-line
            data-attends
            style={{ ...at(0.5 + (tiles.length - i) * 0.09), strokeWidth: 1 + 3.2 * w, strokeOpacity: 0.28 + 0.62 * w }}
          />
        );
      })}
      <Words x={(from + far) / 2} y={y - (0.42 * (from - far)) / 2 - 12} tone="pencil" weight={650} d={1.05}>
        {t.attention}
      </Words>
      {tiles.map((tile, i) => (
        <g key={i}>
          <rect x={tile.x} y={y} width={tile.w} height={h} rx={7} pathLength={1} data-line data-tile style={at(0.05 + i * 0.07)} />
          <Words x={tile.x + tile.w / 2} y={y + 29} size={17} weight={600} d={0.25 + i * 0.07}>
            {tile.word}
          </Words>
        </g>
      ))}
      <rect x={ghost.x} y={y} width={ghost.w} height={h} rx={7} data-fade data-ghost style={at(0.45)} />
      <Words x={ghost.x + ghost.w / 2} y={y + 30} size={19} weight={600} tone="pencil" d={0.5}>
        ?
      </Words>
      <path
        d={`M${ghost.x + ghost.w + 6} ${y + 23}C${brain.x - 10} ${y + 23} ${brain.x} ${y} ${brain.x + 14} ${brain.y + brain.h - 6}`}
        pathLength={1}
        data-line
        data-flow
        style={at(0.9)}
      />
      <Painted id="brain" x={brain.x} y={brain.y} w={brain.w} h={brain.h} d={0.7} />
      <path
        d={`M${brain.x + 38} ${brain.y - 4}L${brain.x + 58} ${card.y + card.h + 6}M${brain.x + 49} ${card.y + card.h + 8}l9 -2 1 9`}
        pathLength={1}
        data-line
        data-flow
        style={at(1.05)}
      />
      <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={9} pathLength={1} data-line data-card style={at(0.2)} />
      <Words x={card.x + 18} y={card.y + 27} anchor="start" tone="quiet" weight={600} d={0.45}>
        {t.next}
      </Words>
      {t.options.map(([word, p], i) => {
        const row = card.y + 58 + i * 28,
          len = Math.max(6, (p / 62) * reach);
        return (
          <g key={word}>
            <Words x={card.x + 18} y={row} anchor="start" size={15} weight={650} d={0.55 + i * 0.08}>
              {word}
            </Words>
            <rect
              x={bar}
              y={row - 9}
              width={len}
              height={8}
              rx={4}
              data-bar={i === 0 ? "top" : ""}
              data-grow
              style={at(0.65 + i * 0.1)}
            />
            <Words x={bar + len + 8} y={row} anchor="start" size={12} tone="quiet" d={0.75 + i * 0.1}>
              {p}%
            </Words>
          </g>
        );
      })}
      <path d={`M${far} 136V${y - 18}`} pathLength={1} data-line data-leader style={at(1.15)} />
      <circle cx={far} cy={y - 14} r={3} data-fade data-dot style={at(1.35)} />
      {t.note.map((line, i) => (
        <Words key={i} x={far - 24} y={62 + i * 23} anchor="start" size={14} weight={i ? 500 : 650} tone={i ? "quiet" : "ink"} d={1.2 + i * 0.08}>
          {line}
        </Words>
      ))}
      <Opens x={brain.x + brain.w - 14} y={brain.y - 11} label={t.open} d={1.4} />
    </>
  );
}

/** Who is who in Dream of the Red Chamber: five portraits, each named, and the ties
 * between them written on the lines; the hero opens onto his own story. */
function Kin() {
  const t = useT().opening.kin;
  // The grandmother, the hero, the two cousins either side of him, the one who runs the house.
  const people = [
    { id: "matriarch", x: 268, y: 8, w: 104, h: 124 },
    { id: "youth", x: 264, y: 196, w: 112, h: 132 },
    { id: "rose", x: 64, y: 206, w: 104, h: 122 },
    { id: "lady", x: 472, y: 206, w: 104, h: 122 },
    { id: "noblewoman", x: 494, y: 14, w: 94, h: 112 },
  ];
  const ties: {
    d: string;
    at: [number, number];
    anchor: "start" | "middle" | "end";
    tone: "ink" | "pencil";
    dashed?: boolean;
  }[] = [
    { d: "M320 158V190", at: [334, 178], anchor: "start", tone: "ink" },
    { d: "M262 86C196 96 140 132 122 200", at: [178, 112], anchor: "end", tone: "ink" },
    { d: "M258 268H174", at: [216, 260], anchor: "middle", tone: "pencil" },
    { d: "M382 268H466", at: [424, 260], anchor: "middle", tone: "ink", dashed: true },
    { d: "M488 70H378", at: [433, 62], anchor: "middle", tone: "ink" },
  ];
  return (
    <>
      {ties.map((tie, i) => (
        <path
          key={i}
          d={tie.d}
          pathLength={tie.dashed ? undefined : 1}
          data-line={tie.dashed ? undefined : ""}
          data-fade={tie.dashed ? "" : undefined}
          data-tie={tie.tone}
          data-dashed={tie.dashed || undefined}
          style={at(0.55 + i * 0.1)}
        />
      ))}
      {people.map((p, i) => (
        <g key={p.id}>
          <Painted id={p.id} x={p.x} y={p.y} w={p.w} h={p.h} d={0.05 + i * 0.1} />
          <Words x={p.x + p.w / 2} y={p.y + p.h + 22} size={15} weight={650} d={0.45 + i * 0.07}>
            {t.names[i]}
          </Words>
        </g>
      ))}
      {ties.map((tie, i) => (
        <Words
          key={i}
          x={tie.at[0]}
          y={tie.at[1]}
          anchor={tie.anchor}
          tone={tie.tone === "pencil" ? "pencil" : "quiet"}
          weight={600}
          d={0.85 + i * 0.07}
        >
          {t.ties[i]}
        </Words>
      ))}
      <Opens x={376 - 14} y={196 - 11} label={t.open} d={1.3} />
    </>
  );
}

const drawings: Record<SpecimenKind, () => ReactNode> = { solar: Solar, model: Model, kin: Kin };

/** The drawing a request would give, with the measure under it that says it is a sample. */
export function Specimen({ kind, label }: { kind: SpecimenKind; label: string }) {
  const t = useT().opening;
  const Drawing = drawings[kind];
  const mid = W / 2,
    half = wide(t.sample, 12) / 2 + 12;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-kind={kind}>
      <Drawing />
      <g data-measure data-sample>
        <path
          d={`M24 ${H - 14}H${mid - half}M${mid + half} ${H - 14}H${W - 24}M20 ${H - 10}L28 ${H - 18}M${W - 28} ${H - 10}L${W - 20} ${H - 18}`}
          data-fade
          style={at(0.2)}
        />
        <Words x={mid} y={H - 9.8} size={12} tone="pencil" weight={650} d={0.25}>
          {t.sample}
        </Words>
      </g>
    </svg>
  );
}
