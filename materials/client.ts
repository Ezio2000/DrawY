import type {
  Bindings,
  Describe,
  Material,
  MaterialKind,
  MaterialPage,
  MaterialRef,
  MaterialType,
  Reserve,
  SearchRequest,
  SearchResult,
  Shelf,
  Viewer,
} from "./schema.ts";
import { viewerOf } from "./schema.ts";

/** How many materials one batch request reads; the service refuses more. */
const BATCH = 200;
/** Talks to a material library service on behalf of one user at a time. */
export class MaterialsClient {
  constructor(readonly base: string) {}
  private async call<T>(
    path: string,
    viewer: Viewer,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(viewerHeaders(viewer)))
      headers.set(k, v);
    if (typeof init.body === "string")
      headers.set("Content-Type", "application/json");
    const r = await fetch(this.base + path, { ...init, headers });
    if (!r.ok) {
      const text = await r.text();
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {}
      throw new MaterialsError(message, r.status);
    }
    return (
      r.headers.get("content-type")?.includes("json")
        ? r.json()
        : r.arrayBuffer()
    ) as Promise<T>;
  }
  search(request: SearchRequest, user?: Viewer) {
    return this.call<SearchResult[]>("/search", user, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
  browse(
    query: string,
    page: number,
    user?: Viewer,
    kinds: MaterialKind[] = [],
    size?: number,
    shelf?: Shelf,
    types: string[] = [],
  ) {
    return this.call<MaterialPage>(
      `/browse?q=${encodeURIComponent(query)}&page=${page}&kind=${kinds.join(",")}${types.length ? "&type=" + types.join(",") : ""}${size ? "&size=" + size : ""}${shelf ? "&shelf=" + shelf : ""}`,
      user,
    );
  }
  /** Makes a user's picture public, or gives a published one back to its maker. */
  publish(id: string, published: boolean) {
    return this.call<Material>(
      `/materials/${encodeURIComponent(id)}/owner`,
      undefined,
      { method: "POST", body: JSON.stringify({ published }) },
    );
  }
  /** The named materials, each at the version asked for or the current one; leniently,
   * only those that exist. */
  async get(ids: (string | MaterialRef)[], user?: Viewer, lenient = false) {
    // The service reads a bounded number at a time; a work may name more.
    const chunks: (string | MaterialRef)[][] = [];
    for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.call<Material[]>("/materials/batch", user, {
          method: "POST",
          body: JSON.stringify({ ids: chunk, lenient }),
        }),
      ),
    );
    return pages.flat();
  }
  /** The material types the library holds. */
  types() {
    return this.call<MaterialType[]>("/types", undefined);
  }
  /** Which drawing the app's own editing uses for text, pictures and links. */
  bindings() {
    return this.call<Bindings>("/bindings", undefined);
  }
  reserve(input: Reserve, user: string) {
    return this.call<Material>("/materials/reserve", user, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  /** Stores a reserved picture's file. A cut-out (`transparent`) with nothing clear in it
   * is refused with 422 and stays developing, so it can be painted again. */
  develop(
    id: string,
    bytes: Uint8Array,
    mediaType: string,
    user: string,
    transparent = false,
  ) {
    return this.call<Material>(
      `/materials/${encodeURIComponent(id)}/file${transparent ? "?transparent=1" : ""}`,
      user,
      {
        method: "PUT",
        body: new Blob([new Uint8Array(bytes)], { type: mediaType }),
        headers: { "Content-Type": mediaType },
      },
    );
  }
  fail(id: string, error: string, user: string) {
    return this.call<Material>(
      `/materials/${encodeURIComponent(id)}/fail`,
      user,
      {
        method: "POST",
        body: JSON.stringify({ error }),
      },
    );
  }
  ingest(bytes: Uint8Array, mediaType: string, meta: Describe, user: string) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mediaType }),
      "upload",
    );
    form.append("meta", JSON.stringify(meta));
    return this.call<Material>("/materials", user, {
      method: "POST",
      body: form,
    });
  }
  use(ids: string[], work: string, user: string) {
    return this.call<{ ok: true }>("/uses", user, {
      method: "POST",
      body: JSON.stringify({ ids, work }),
    });
  }
  /** A picture's file, inked in `color` when it is a recolourable one. */
  async file(id: string, user?: Viewer, wait = 240, color?: string, version?: number) {
    return new Uint8Array(
      await this.call<ArrayBuffer>(
        `/files/${encodeURIComponent(id)}?wait=${wait}${color ? "&color=" + encodeURIComponent(color) : ""}${version ? "&v=" + version : ""}`,
        user,
      ),
    );
  }
  async thumb(id: string, user?: Viewer, size = 256) {
    return new Uint8Array(
      await this.call<ArrayBuffer>(
        `/thumbs/${encodeURIComponent(id)}?size=${size}`,
        user,
      ),
    );
  }
}
/** The headers that tell the library who a request is for. */
export function viewerHeaders(viewer: Viewer): Record<string, string> {
  const v = viewerOf(viewer);
  return v
    ? { "x-drawy-user": v.id, ...(v.all ? { "x-drawy-access": "all" } : {}) }
    : {};
}
export class MaterialsError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
