import type { UserStore } from "../storage/index.ts";
export interface Material {
  id: string;
  name: string;
  about: string;
  url: string;
  kind: string;
  tags?: string;
  width?: number;
  height?: number;
  shelf?: string;
}
export async function catalogue() {
  const r = await fetch(
    (process.env.DRAWY_MATERIALS_URL || "http://localhost:8090") +
      "/catalogue.json",
  );
  if (!r.ok) throw Error("素材库不可用");
  return (await r.json()) as {
    shelves: { pieces: (Material & { src?: string })[] }[];
    styles: unknown[];
    icons: Record<string, unknown>;
  };
}
export async function findMaterials(store: UserStore, query: string) {
  const c = await catalogue();
  const all: Material[] = [
    ...store
      .assets()
      .filter((a) => a.source !== "review")
      .map((a) => ({ ...a, kind: "personal", about: a.name })),
    ...c.shelves
      .flatMap((s) => s.pieces)
      .map((p) => ({
        ...p,
        url:
          p.kind === "painting"
            ? "/materials/" + p.src?.replace(/^\/?(paintings\/)?/, "paintings/")
            : `/materials/icons/${p.id}.svg`,
      })),
  ];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .map((m) => ({
      m,
      score: terms.reduce(
        (n, t) =>
          n +
          Number(
            `${m.name} ${m.about} ${m.tags ?? ""} ${m.shelf ?? ""}`
              .toLowerCase()
              .includes(t),
          ),
        0,
      ),
    }))
    .filter((r) => !terms.length || r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 36)
    .map((r) => r.m);
}
