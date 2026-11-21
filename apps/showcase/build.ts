import { mkdir, writeFile } from "node:fs/promises";
import type { Work } from "../../modules/contracts/index.ts";
import { sayIn, type Lang, type ShowcaseFile, type ShowcaseSource } from "./kit.ts";
import { solar } from "./works/solar.ts";
import { night } from "./works/night.ts";
import { styled } from "./works/styles.ts";
import { inside } from "./works/inside.ts";
import { lens } from "./works/lens.ts";
import { rhythm } from "./works/rhythm.ts";
import { range } from "./works/range.ts";
import { coast } from "./works/coast.ts";
import { navigate } from "./works/navigate.ts";
import { history } from "./works/history.ts";
import { family } from "./works/family.ts";

/* Makes the home page's works on a running DrawY, the way any work is made: a new work,
 * then each version's edits laid on it by the server, which takes in the library drawings
 * and pictures they name. What comes back after each version is kept, with the brief the
 * author settled on, in apps/web/src/home/showcase.
 *
 *   DRAWY_URL=http://127.0.0.1:8080 DRAWY_ADMIN_USER=… DRAWY_ADMIN_PASS=… \
 *     pnpm exec tsx apps/showcase/build.ts [id…]
 */

export const sources: ShowcaseSource[] = [solar, night, styled, inside, lens, rhythm, range, coast, navigate, history, family];
const base = process.env.DRAWY_URL || "http://127.0.0.1:8080";
const out = new URL("../web/src/home/showcase/", import.meta.url);

let cookie = "";
async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await r.text();
  if (!r.ok) throw Error(`${method} ${path}: ${r.status} ${text}`);
  return JSON.parse(text) as T;
}

/** A work as the home page keeps it: no account's id, and no time it was made. */
function kept(work: Work, id: string, brief: Work["brief"]): Work {
  return { ...work, id: "showcase-" + id, brief, updatedAt: 0 };
}

async function build(source: ShowcaseSource, lang: Lang) {
  const say = sayIn(lang);
  let work = await call<Work>("/works", "POST", { title: source.title(say) });
  const made = work.id;
  const versions: Work[] = [];
  for (const edit of source.versions(say)) {
    work = await call<Work>(`/works/${made}/edits`, "POST", { baseRevision: work.revision, edit });
    versions.push(kept(await call<Work>(`/works/${made}`), source.id, source.brief(say)));
  }
  // The versions share their materials; each names the ones it holds.
  const materials = Object.assign({}, ...versions.map((v) => v.materials));
  const file: ShowcaseFile = {
    materials,
    versions: versions.map((v) => ({ ...v, materials: Object.keys(v.materials) })),
  };
  await writeFile(new URL(`${source.id}.${lang}.json`, out), JSON.stringify(file) + "\n");
  console.log(`${source.id}.${lang}: ${versions.length} versions (work ${made})`);
  return made;
}

await call("/auth/login", "POST", {
  name: process.env.DRAWY_ADMIN_USER,
  password: process.env.DRAWY_ADMIN_PASS,
});
await mkdir(out, { recursive: true });
const only = process.argv.slice(2);
for (const source of sources.filter((s) => !only.length || only.includes(s.id)))
  for (const lang of ["zh", "en"] as const) await build(source, lang);
