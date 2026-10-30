import sharp from "sharp";

export interface Measured {
  bytes: Buffer;
  mediaType: string;
  width: number;
  height: number;
  background: "transparent" | "opaque";
  content: { x: number; y: number; width: number; height: number };
  palette: string[];
  recolor: boolean;
}
const round = (n: number) => Math.round(n * 1000) / 1000;
const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** A few colours that carry the picture, ignoring paper and transparency, darkest first. */
async function palette(image: ReturnType<typeof sharp>) {
  const { data, info } = await image
    .clone()
    .resize(40, 40, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<
    number,
    { n: number; r: number; g: number; b: number }
  >();
  for (let i = 0; i < info.width * info.height * 4; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128 || (r > 238 && g > 238 && b > 238)) continue;
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const c = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += r;
    c.g += g;
    c.b += b;
    buckets.set(k, c);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((c) => [c.r / c.n, c.g / c.n, c.b / c.n].map(Math.round))
    .sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))
    .map(([r, g, b]) => hex(r, g, b));
}
/** Measures a picture and stores rasters as WebP. */
export async function measure(
  input: Uint8Array,
  mediaType: string,
): Promise<Measured> {
  const bytes = Buffer.from(input);
  const svg = mediaType === "image/svg+xml";
  const image = sharp(bytes, { density: svg ? 288 : 72 });
  const meta = await image.metadata();
  const width = meta.width!,
    height = meta.height!;
  let transparent = svg;
  if (!svg && meta.hasAlpha) {
    const { data, info } = await image
      .clone()
      .resize(64, 64, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let clear = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 16) clear++;
    transparent = clear / (info.width * info.height) > 0.04;
  }
  let content = { x: 0, y: 0, width: 1, height: 1 };
  if (transparent) {
    const trimmed = await image
      .clone()
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
      .toBuffer({ resolveWithObject: true })
      .catch(() => null);
    const info = trimmed?.info;
    if (info && info.trimOffsetLeft !== undefined)
      content = {
        x: round(-info.trimOffsetLeft / width),
        y: round(-info.trimOffsetTop! / height),
        width: round(Math.min(1, info.width / width)),
        height: round(Math.min(1, info.height / height)),
      };
  }
  const raster = !svg && mediaType !== "image/gif";
  return {
    bytes: raster
      ? await image.clone().webp({ quality: 90, alphaQuality: 100 }).toBuffer()
      : bytes,
    mediaType: raster ? "image/webp" : mediaType,
    width,
    height,
    background: transparent ? "transparent" : "opaque",
    content,
    palette: await palette(image),
    recolor: svg && bytes.toString("utf8").includes("currentColor"),
  };
}
/** A small PNG on white paper, the way a model should look at a candidate. */
export function thumbnail(bytes: Uint8Array, mediaType: string, size: number) {
  return sharp(Buffer.from(bytes), {
    density: mediaType === "image/svg+xml" ? 288 : 72,
  })
    .resize(size, size, {
      fit: "inside",
      withoutEnlargement: mediaType !== "image/svg+xml",
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}
/** An SVG drawn in currentColor, inked in the given colour. */
export function recolor(svg: Uint8Array, color: string) {
  return Buffer.from(
    Buffer.from(svg).toString("utf8").replaceAll("currentColor", color),
  );
}
