import { useEffect, useRef, useState } from "react";
import {
  Clipboard,
  Download,
  FileCode2,
  FileImage,
  FileText,
  ImageDown,
  RectangleHorizontal,
  RectangleVertical,
  Share2,
  Square,
} from "lucide-react";
import { Spinner, useLocale } from "@drawy/ui";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";
import { useDismiss } from "./Rail.tsx";
import type { Work } from "../../../modules/contracts/index.ts";

type Format =
  | "png"
  | "jpeg"
  | "square"
  | "portrait"
  | "wide"
  | "pdf"
  | "html"
  | "copy"
  | "share";
/** The sizes social posts take, in pixels. */
const cards = {
  square: [1080, 1080],
  portrait: [1080, 1350],
  wide: [1920, 1080],
} as const;

const save = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.hidden = true;
  // Some browsers name a download only when its link is in the document.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};
const nameOf = (r: Response, fallback: string) =>
  decodeURIComponent(
    r.headers.get("content-disposition")?.match(/filename\*=UTF-8''(.+)$/)?.[1] || fallback,
  );
const image = (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(Error(type))), type, quality),
  );
/** Words broken into lines that fit a width, at most `max` lines, the last cut short. */
function lines(ctx: CanvasRenderingContext2D, text: string, width: number, max: number) {
  const out: string[] = [];
  // Chinese breaks anywhere; other scripts break at spaces.
  const parts = text.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+\s*|\s+/g) ?? [];
  let line = "";
  for (const p of parts) {
    if (ctx.measureText(line + p).width > width && line) {
      out.push(line.trimEnd());
      line = p.trimStart();
    } else line += p;
  }
  if (line) out.push(line.trimEnd());
  if (out.length > max) {
    out.length = max;
    out[max - 1] = out[max - 1].replace(/.$/, "…");
  }
  return out;
}
/** The part of a picture that is drawn on: its paper margin cut away, so the drawing can
 * be placed as large as a card allows. */
function trimmed(img: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  // The paper is whatever colour the corner has.
  const [r0, g0, b0] = [data[0], data[1], data[2]];
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y += 2)
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      if (
        data[i + 3] > 16 &&
        Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) > 18
      ) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) return { x: 0, y: 0, width, height };
  const pad = Math.round(Math.max(width, height) * 0.01);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  return {
    x: x0,
    y: y0,
    width: Math.min(width, x1 + pad) - x0,
    height: Math.min(height, y1 + pad) - y0,
  };
}
/** The drawing on a card of paper the size social posts take, with its title above and
 * where it was made below, so it reads on its own wherever it is shared. */
async function card(png: Blob, title: string, credit: string, [W, H]: readonly [number, number]) {
  const img = await image(png);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const css = getComputedStyle(document.body);
  const serif = css.getPropertyValue("--font-serif").trim() || "Georgia, serif";
  const sans = css.getPropertyValue("--font").trim() || "system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const pad = Math.round(Math.min(W, H) * 0.07);
  const size = Math.round(Math.min(W, H) * (W > H ? 0.05 : 0.056));
  ctx.font = `500 ${size}px ${serif}`;
  ctx.fillStyle = "#141413";
  ctx.textBaseline = "top";
  const head = lines(ctx, title, W - pad * 2, 2);
  head.forEach((l, i) => ctx.fillText(l, pad, pad + i * size * 1.25));
  const top = pad + head.length * size * 1.25 + size * 0.6;
  const foot = Math.round(size * 0.42);
  const bottom = H - pad - foot * 1.8;
  // The drawing, as large as fits between title and credit.
  const box = trimmed(img);
  const k = Math.min((W - pad * 2) / box.width, (bottom - top) / box.height);
  const w = box.width * k,
    h = box.height * k;
  ctx.drawImage(
    img,
    box.x,
    box.y,
    box.width,
    box.height,
    (W - w) / 2,
    top + (bottom - top - h) / 2,
    w,
    h,
  );
  URL.revokeObjectURL(img.src);
  ctx.font = `${foot}px ${sans}`;
  ctx.fillStyle = "#87867f";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.fillText(credit, W - pad, H - pad);
  ctx.fillStyle = "#c8553d";
  ctx.beginPath();
  ctx.arc(W - pad - ctx.measureText(credit).width - foot * 0.9, H - pad - foot * 0.35, foot * 0.28, 0, Math.PI * 2);
  ctx.fill();
  return blobOf(canvas, "image/png");
}
/** A PNG as a JPEG on paper: smaller, and without the transparency chat apps turn black. */
async function jpeg(png: Blob) {
  const img = await image(png);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(img.src);
  return blobOf(canvas, "image/jpeg", 0.9);
}

/** Saving or sending the scene in the form the place it goes to wants: the picture itself,
 * a card for social posts, a page for print, or the work as a file that stays explorable. */
export function ExportMenu({
  work,
  sceneId,
  disabled,
  fail,
  done,
}: {
  work: Work;
  sceneId: string;
  disabled: boolean;
  fail: (e: unknown) => void;
  /** Says something went well, such as a copy. */
  done: (message: string) => void;
}) {
  const t = useT(),
    locale = useLocale();
  const w = t.exports;
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState<Format>();
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  // The picture is drawn once per revision and reused by every form made from it.
  const cache = useRef<{ key: string; blob: Promise<Response> }>(undefined);
  useEffect(() => setOpen(false), [sceneId]);
  const base = `/api/works/${work.id}/scenes/${encodeURIComponent(sceneId)}`;
  const fetchFile = async (path: string) => {
    const r = await fetch(path, { headers: { "x-drawy-locale": locale } });
    if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r;
  };
  const png = async () => {
    const key = `${work.id}:${sceneId}:${work.revision}`;
    if (cache.current?.key !== key)
      cache.current = { key, blob: fetchFile(base + "/picture") };
    const r = (await cache.current.blob.catch((e) => {
      cache.current = undefined;
      throw e;
    })).clone();
    return { blob: await r.blob(), name: nameOf(r, "drawy.png") };
  };
  // Sharing needs the click that asked for it, which a picture still being drawn would
  // outlast: the picture is drawn when the menu opens and sharing waits until it is ready.
  const [ready, setReady] = useState<{ key: string; blob: Blob; name: string }>();
  const key = `${work.id}:${sceneId}:${work.revision}`;
  useEffect(() => {
    if (!open) return;
    let live = true;
    png().then(
      (p) => live && setReady({ key, ...p }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [open, key]);
  const title =
    work.scenes[sceneId]?.parentId ? `${work.title} · ${work.scenes[sceneId].title}` : work.title;
  const share =
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [new File([""], "a.png", { type: "image/png" })] });
  async function run(format: Format) {
    setBusy(format);
    try {
      // The clipboard is written within the click, handed the picture still to come.
      if (format === "copy") {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": png().then((p) => p.blob) }),
        ]);
        done(w.copied);
        setOpen(false);
        return;
      }
      if (format === "share") {
        const p = ready!;
        await navigator
          .share({ title, files: [new File([p.blob], p.name, { type: "image/png" })] })
          .catch((e) => {
            if (e?.name !== "AbortError") throw e;
          });
        setOpen(false);
        return;
      }
      if (format === "pdf" || format === "html") {
        const r = await fetchFile(base + (format === "pdf" ? "/picture?format=pdf" : "/page"));
        save(await r.blob(), nameOf(r, "drawy." + format));
      } else {
        const { blob, name } = await png();
        const stem = name.replace(/\.png$/, "");
        if (format === "png") save(blob, name);
        else if (format === "jpeg") save(await jpeg(blob), stem + ".jpg");
        else save(await card(blob, title, w.credit, cards[format]), `${stem} · ${w[format]}.png`);
      }
      setOpen(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  }
  const preparing = (format: Format) => format === "share" && ready?.key !== key;
  const item = (format: Format, Icon: typeof Download, label: string) => (
    <button
      key={format}
      role="menuitem"
      disabled={!!busy || preparing(format)}
      onClick={() => void run(format)}
    >
      {busy === format || preparing(format) ? <Spinner size={15} /> : <Icon size={16} />}
      <span>{label}</span>
    </button>
  );
  return (
    <div className={cx("export")} ref={ref}>
      <button
        aria-label={w.title}
        data-tip={open ? undefined : w.title}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {busy ? <Spinner size={15} /> : <Download size={17} />}
      </button>
      {open && (
        <div className={cx("export-menu")} role="menu">
          <h4>{w.picture}</h4>
          {item("png", FileImage, w.png)}
          {item("jpeg", ImageDown, w.jpeg)}
          {item("copy", Clipboard, w.copy)}
          {share && item("share", Share2, w.share)}
          <h4>{w.cards}</h4>
          <div className={cx("export-cards")}>
            {(["square", "portrait", "wide"] as const).map((f) => {
              const Icon = { square: Square, portrait: RectangleVertical, wide: RectangleHorizontal }[f];
              return (
                <button key={f} role="menuitem" disabled={!!busy} onClick={() => void run(f)}>
                  {busy === f ? <Spinner size={15} /> : <Icon size={18} />}
                  <span>{w[f]}</span>
                  <small>{w.ratio[f]}</small>
                </button>
              );
            })}
          </div>
          <h4>{w.other}</h4>
          {item("html", FileCode2, w.html)}
          {item("pdf", FileText, w.pdf)}
        </div>
      )}
    </div>
  );
}
