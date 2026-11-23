// Builds the shaded relief the geomap drawing lays over land (seed/geo/relief) from
// Natural Earth's shaded relief rasters, in plate carrée as they come: a whole-world
// overview and two finer levels cut into square tiles. Tiles with no relief in them (open
// sea, flat land) are left out, and the index lists those kept.
//
//   pnpm --dir materials relief
//
// Needs network access and unzip.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const base = "https://naciscdn.org/naturalearth";
const out = new URL("./seed/geo/relief/", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "drawy-relief-"));
sharp.cache(false);

/** The grey of flat ground and of the sea in Natural Earth's rasters: darker is a slope
 * turned from the light, lighter one turned to it. */
const FLAT = 206;

/** A raster, from `NE_RASTERS` (a folder of the unzipped downloads) when it is there. */
async function raster(path: string) {
  const name = path.split("/").at(-1)!;
  const local =
    process.env.NE_RASTERS && join(process.env.NE_RASTERS, name + ".tif");
  if (local && existsSync(local)) return local;
  const r = await fetch(`${base}/${path}.zip`);
  if (!r.ok) throw Error(`${path}: ${r.status}`);
  const file = join(dir, name + ".zip");
  writeFileSync(file, new Uint8Array(await r.arrayBuffer()));
  execFileSync("unzip", ["-oq", file, "-d", join(dir, name)]);
  return join(dir, name, name + ".tif");
}

type Level = { ppd: number; tile: number; tiles: string[] };
/** One level: the raster at `ppd` pixels a degree, in tiles `tile` degrees square. */
async function level(
  source: string,
  index: number,
  ppd: number,
  tile: number,
): Promise<Level> {
  const width = 360 * ppd,
    height = 180 * ppd;
  const { data } = await sharp(source, { limitInputPixels: false })
    .extractChannel(0)
    .resize(width, height, { kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const size = tile * ppd,
    tiles: string[] = [];
  for (let row = 0; row < 180 / tile; row++)
    for (let col = 0; col < 360 / tile; col++) {
      const px = Buffer.alloc(size * size);
      let relief = 0;
      for (let y = 0; y < size; y++) {
        const from = (row * size + y) * width + col * size;
        data.copy(px, y * size, from, from + size);
        for (let x = 0; x < size; x++)
          if (Math.abs(px[y * size + x] - FLAT) > 6) relief++;
      }
      // Fewer than one pixel in a thousand off flat: nothing worth a request.
      if (relief < (size * size) / 1000) continue;
      const key = `${col}-${row}`;
      await sharp(px, { raw: { width: size, height: size, channels: 1 } })
        .webp({ quality: 72 })
        .toFile(join(out, `${index}-${key}.webp`));
      tiles.push(key);
    }
  return { ppd, tile, tiles };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
try {
  const coarse = await raster("50m/raster/SR_50M");
  const fine = await raster("10m/raster/SR_HR");
  const levels = [
    await level(coarse, 0, 6, 180),
    await level(coarse, 1, 30, 30),
    await level(fine, 2, 60, 15),
  ];
  writeFileSync(
    join(out, "..", "relief.json"),
    JSON.stringify({ flat: FLAT, levels }),
  );
  console.log(
    levels.map((l) => `${l.ppd} px/°: ${l.tiles.length} tiles`).join("\n"),
    `\n${readdirSync(out).length} files`,
  );
} finally {
  rmSync(dir, { recursive: true });
}
