import { useEffect, useRef } from "react";
import { cx } from "./cx.ts";
const bodies = [
  { painting: "rock", a: 103, size: 14, phase: 332 },
  { painting: "sand", a: 139, size: 13, phase: 115 },
  { painting: "earth", a: 176, size: 22, phase: 269 },
  { painting: "sand", a: 211, size: 10, phase: 200 },
  { painting: "jupiter", a: 245, size: 37, phase: 29 },
  { painting: "saturn", a: 278, size: 14, phase: 321 },
];
export function OrbitSketch() {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      ref.current
        ?.querySelectorAll<SVGImageElement>("[data-orbit]")
        .forEach((image, i) => {
          const b = bodies[i],
            angle = (b.phase * Math.PI) / 180 + t * (103 / b.a) ** 1.5 * 0.22;
          image.setAttribute("x", String(Math.cos(angle) * b.a - b.size));
          image.setAttribute(
            "y",
            String(Math.sin(angle) * b.a * 0.423 - b.size),
          );
        });
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <svg className={cx("sketch")} viewBox="-325 -150 650 300" aria-hidden>
      <g ref={ref}>
        {bodies.map((b) => (
          <ellipse
            key={b.a}
            rx={b.a}
            ry={b.a * 0.423}
            fill="none"
            stroke="#c6c0b2"
            strokeWidth="1"
          />
        ))}
        <image
          href="/materials/paintings/sun.webp"
          x="-88"
          y="-88"
          width="176"
          height="176"
        />
        {bodies.map((b) => (
          <image
            data-orbit
            key={b.a}
            href={`/materials/paintings/${b.painting}.webp`}
            width={b.size * 2}
            height={b.size * 2}
          />
        ))}
      </g>
    </svg>
  );
}
