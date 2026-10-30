import { useId, type CSSProperties } from "react";
import { random } from "./hand.tsx";
import { handLine, pointsOf } from "./pen.tsx";
const useCatalogue = () => ({
  painting: (id: string) => ({ src: `/materials/paintings/${id}.webp` }),
});
import { cx } from "./cx.ts";

/* Each painted subject is an independent transparent asset. SVG supplies the composition,
 * tracks, notes and relationships so their geometry remains editable and interactive. */
const order = (i: number) => ({ "--i": i }) as CSSProperties;
type Point = [number, number];
/** A lightly wavering pencil line, with the same small irregularities on every render. */
function ink(points: number[], seed: number) {
  const r = random(seed);
  return "M" + pointsOf(handLine(points, () => 0.5 + (r() - 0.5) / 8, 12));
}

const NODES = [
  { at: [48, 196] as Point, r: 19, tone: "lit" },
  { at: [160, 160] as Point, r: 19, tone: "grey" },
  { at: [284, 80] as Point, r: 21, tone: "lit" },
  { at: [240, 232] as Point, r: 23, tone: "paper" },
  { at: [400, 204] as Point, r: 19, tone: "grey" },
  { at: [488, 244] as Point, r: 17, tone: "lit" },
];
const LINKS = [
  [48, 196, 96, 169, 160, 160],
  [160, 160, 207, 93, 284, 80],
  [284, 80, 366, 99, 400, 204],
  [400, 204, 448, 217, 488, 244],
  [160, 160, 187, 209, 240, 232],
  [240, 232, 321, 239, 400, 204],
];
const NOTES = [
  { x: 22, y: 61, w: 110, h: 51, tail: [98, 112, 137, 147, 115, 112] },
  { x: 324, y: 5, w: 123, h: 58, tail: [345, 63, 307, 79, 363, 63] },
  { x: 460, y: 116, w: 120, h: 54, tail: [478, 170, 423, 196, 499, 170] },
  { x: 68, y: 245, w: 114, h: 45, tail: [155, 245, 216, 230, 178, 245] },
];
function nodeShape(x: number, y: number, r: number) {
  return (
    "M" +
    (x - r) +
    " " +
    y +
    "C" +
    [x - r - 1, y - r * 0.61, x - r * 0.5, y - r - 1, x + 1, y - r].join(" ") +
    "S" +
    [x + r + 1, y - r * 0.52, x + r, y + 1].join(" ") +
    "S" +
    [x + r * 0.5, y + r + 1, x - 1, y + r].join(" ") +
    "S" +
    [x - r - 1, y + r * 0.53, x - r, y].join(" ") +
    "Z"
  );
}
function scribble(x: number, y: number, w: number, seed: number) {
  return ink(
    Array.from({ length: Math.floor(w / 5) }, (_, i) => [
      x + i * 5,
      y + Math.sin(i * 2.3 + seed) * 1.8,
    ]).flat(),
    seed,
  );
}

/** Nodes and notes are individual hand-drawn shapes; their fills light in sequence. */
export function ModelSketch() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      className={cx("sketch model-sketch")}
      viewBox="-45 -22.5 690 345"
      aria-hidden
    >
      <defs>
        <pattern
          id={id}
          width="9"
          height="9"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(24)"
        >
          <path className={cx("node-hatch")} d="M2 0V9M5 1V7" />
        </pattern>
      </defs>
      {LINKS.map((points, i) => (
        <path key={i} className={cx("link")} d={ink(points, 121 + i)} />
      ))}
      <path
        className={cx("link attends")}
        d={ink([284, 80, 266, 148, 240, 232], 131)}
      />
      {NOTES.map((n, i) => (
        <g key={i} className={cx("note")}>
          <path
            className={cx("note-body")}
            d={
              ink(
                [
                  n.x + 5,
                  n.y,
                  n.x + n.w - 4,
                  n.y,
                  n.x + n.w,
                  n.y + 5,
                  n.x + n.w,
                  n.y + n.h - 4,
                  n.x + n.w - 5,
                  n.y + n.h,
                  n.x + 4,
                  n.y + n.h,
                  n.x,
                  n.y + n.h - 4,
                  n.x,
                  n.y + 5,
                  n.x + 5,
                  n.y,
                ],
                141 + i,
              ) + "Z"
            }
          />
          <path className={cx("note-tail")} d={ink(n.tail, 151 + i)} />
          <path
            className={cx("note-line")}
            d={scribble(n.x + 13, n.y + 19, n.w - 25, 161 + i)}
          />
          <path
            className={cx("note-line")}
            d={scribble(n.x + 13, n.y + 34, n.w - 36, 171 + i)}
          />
        </g>
      ))}
      {NODES.map((n, i) => (
        <g key={i} className={cx("node")} data-tone={n.tone} style={order(i)}>
          <path className={cx("node-dot")} d={nodeShape(...n.at, n.r)} />
          <path
            className={cx("node-grain")}
            d={nodeShape(...n.at, n.r)}
            style={{ fill: "url(#" + id + ")" }}
          />
          <path className={cx("node-light")} d={nodeShape(...n.at, n.r + 3)} />
        </g>
      ))}
    </svg>
  );
}

const FIGURES = [
  { painting: "youth", x: 28, y: 0, w: 118, h: 132 },
  { painting: "rose", x: 456, y: 0, w: 118, h: 132 },
  { painting: "grey", x: 28, y: 168, w: 118, h: 132 },
  { painting: "elder", x: 456, y: 168, w: 118, h: 132 },
  { painting: "lady", x: 222, y: 56, w: 156, h: 195 },
];
const TIES = [
  {
    d: ink([232, 111, 192, 87, 144, 88], 181),
    head: "M152 81L144 88L153 94",
    tone: false,
  },
  {
    d: ink([369, 111, 419, 91, 457, 60], 182),
    head: "M447 60L457 60L454 70",
    tone: true,
  },
  {
    d: ink([228, 180, 187, 194, 145, 232], 183),
    head: "M149 222L145 232L155 229",
    tone: false,
  },
  {
    d: ink([373, 161, 421, 184, 456, 232], 184),
    head: "M446 228L456 232L455 222",
    tone: false,
  },
];

/** Five separately generated portraits, arranged and connected by editable SVG lines. */
export function KinshipSketch() {
  const catalogue = useCatalogue();
  return (
    <svg
      className={cx("sketch kinship-sketch")}
      viewBox="0 0 600 300"
      aria-hidden
    >
      {TIES.map((tie, i) => (
        <g
          key={i}
          className={cx("tie" + (tie.tone ? " tone" : ""))}
          style={order(i)}
        >
          <path d={tie.d} pathLength="1" />
          <path className={cx("tie-head")} d={tie.head} pathLength="1" />
        </g>
      ))}
      {FIGURES.map((p, i) => (
        <image
          key={i}
          href={catalogue.painting(p.painting)?.src}
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
        />
      ))}
    </svg>
  );
}
