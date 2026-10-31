import { cx } from "./cx.ts";

/** What each piece of hand lettering says. */
const words = {
  brand: "DrawY",
  hero: "每个想法，都值得探索",
  works: "作品",
  library: "素材库",
  settings: "设置",
  traces: "运行记录",
  history: "版本",
  journal: "创作过程",
  preferences: "偏好",
  author: "绘制模型",
  image: "图片模型",
} as const;

/** A title lettered by hand with a brush pen and underlined in terracotta, written onto
 * the page as it appears. */
export function Lettering({
  name,
  height,
}: {
  name: keyof typeof words;
  height: number;
}) {
  return (
    <img
      className={cx("lettering")}
      src={`/lettering/${name}.webp`}
      alt={words[name]}
      height={height}
      draggable={false}
    />
  );
}
