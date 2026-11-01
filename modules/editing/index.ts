import type {
  Bounds,
  Drawing,
  Instance,
  Link,
  Param,
  ParamType,
  Scene,
  Work,
  WorkEdit,
} from "../contracts/index.ts";

/* Hand edits: what a person does to a work on the canvas, each turned into one edit of the
 * work that the workspace commits like any other. Nothing here needs code from the person;
 * a change to drawing code is only ever the exact replacement of a word or picture id they
 * pointed at. */

/** A value of a module or link that a person can change, and the control it takes. */
export interface Field {
  key: string;
  /** The author's name for it; without one the app names it by its key. */
  label?: string;
  type: ParamType;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  value: unknown;
  /** Whether the part sets it itself rather than taking its drawing's default. */
  set: boolean;
  /** Whether the drawing still draws without it: a library drawing's default, or for a
   * colour the work's style. Only such a value can be given back. */
  optional: boolean;
}
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\))$/i;
/** Data keys that hold words to read, whatever drawing they belong to. */
const WORDS = new Set([
  "text",
  "label",
  "title",
  "subtitle",
  "sub",
  "heading",
  "caption",
  "note",
  "name",
  "description",
  "detail",
  "word",
  "main",
  "unit",
  "date",
  "quote",
  "message",
  "content",
  "summary",
  "tag",
  "badge",
]);
const rank: Record<ParamType, number> = {
  text: 0,
  picture: 1,
  choice: 2,
  color: 3,
  number: 4,
  boolean: 5,
};
/** What kind of value an undeclared data entry holds, if it is one a person can change:
 * words, a picture, a colour, a number or a switch. Lowercase tokens are left alone, as
 * they are usually states the drawing code tests for. */
function guess(key: string, value: unknown, work: Work): ParamType | null {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number")
    return Number.isFinite(value) ? "number" : null;
  if (typeof value !== "string" || value.length > 400) return null;
  if (work.materials[value]?.kind === "picture") return "picture";
  if (COLOR.test(value.trim())) return "color";
  if (WORDS.has(key) || /[^\x00-\x7f]|\s|[A-Z0-9]/.test(value)) return "text";
  return null;
}
function fits(type: ParamType, value: unknown) {
  if (value === undefined) return true;
  switch (type) {
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    default:
      return typeof value === "string";
  }
}
/** The drawing a module or link is drawn with: the work's own, or a library drawing. */
function drawingOf(work: Work, drawingId: string) {
  const own = work.drawings[drawingId];
  const use = work.materials[drawingId];
  return {
    own,
    library: !own && use?.kind === "drawing" ? use : undefined,
  };
}
/** The values of a module or link a person can change: those its drawing declares, then
 * the other plain values in its data, words first and switches last. */
export function fieldsOf(work: Work, part: Instance | Link): Field[] {
  const { own, library } = drawingOf(work, part.drawingId);
  const declared: Record<string, Omit<Param, "label"> & { label?: string }> =
    own?.params ?? library?.params ?? {};
  const defaults = library?.defaults ?? {};
  const fields: Field[] = [];
  const optional = (key: string, type: ParamType) =>
    !!library && (key in defaults || type === "color");
  for (const [key, p] of Object.entries(declared)) {
    const value = part.data[key] ?? defaults[key];
    if (fits(p.type, value))
      fields.push({
        key,
        ...p,
        value,
        set: part.data[key] !== undefined,
        optional: optional(key, p.type),
      });
  }
  for (const [key, value] of Object.entries(part.data)) {
    if (key in declared) continue;
    const type = guess(key, value, work);
    if (type)
      fields.push({
        key,
        type,
        value,
        set: true,
        optional: optional(key, type),
      });
  }
  return fields.sort((a, b) => rank[a.type] - rank[b.type]);
}

const sceneOf = (work: Work, sceneId: string) => {
  const scene = work.scenes[sceneId];
  if (!scene) throw Error("场景不存在");
  return scene;
};
const edit = (work: Work, scenes: Scene[], extra: Partial<WorkEdit> = {}) => ({
  baseRevision: work.revision,
  scenes,
  ...extra,
});
/** An id not yet used in the work, made from a base: sun, sun-2, sun-3. */
function fresh(base: string, taken: Set<string>) {
  if (!taken.has(base)) return base;
  const stem = base.replace(/-\d+$/, "") || "part";
  let n = 2;
  while (taken.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}
const partIds = (work: Work) =>
  new Set(
    Object.values(work.scenes).flatMap((s) => [
      ...s.modules.map((m) => m.id),
      ...s.links.map((l) => l.id),
    ]),
  );

/** Changes some of a part's values; undefined gives a value back to its drawing's default.
 * Pictures it now shows are named so the work takes them in. */
export function setData(
  work: Work,
  sceneId: string,
  partId: string,
  patch: Record<string, unknown>,
  pictures: string[] = [],
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const apply = <T extends Instance | Link>(p: T): T => {
    if (p.id !== partId) return p;
    const data = { ...p.data };
    for (const [k, v] of Object.entries(patch))
      if (v === undefined) delete data[k];
      else data[k] = v;
    return { ...p, data };
  };
  return edit(
    work,
    [
      {
        ...scene,
        modules: scene.modules.map(apply),
        links: scene.links.map(apply),
      },
    ],
    pictures.length ? { materials: pictures } : {},
  );
}

/** Changes one of the work's shared style tokens, which every drawing reads. */
export function setStyle(work: Work, token: string, value: string): WorkEdit {
  return {
    baseRevision: work.revision,
    style: { ...work.style, [token]: value },
  };
}

/** Puts modules where they were dragged or nudged. */
export function moveParts(
  work: Work,
  sceneId: string,
  moves: { id: string; bounds: Bounds }[],
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const to = new Map(moves.map((m) => [m.id, m.bounds]));
  return edit(work, [
    {
      ...scene,
      modules: scene.modules.map((m) =>
        to.has(m.id) ? { ...m, bounds: { ...to.get(m.id)! } } : m,
      ),
    },
  ]);
}

/** Takes modules and links out of a scene, with the links and checks that need them. */
export function removeParts(
  work: Work,
  sceneId: string,
  ids: string[],
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const gone = new Set(ids);
  return edit(work, [
    {
      ...scene,
      modules: scene.modules.filter((m) => !gone.has(m.id)),
      links: scene.links.filter(
        (l) =>
          !gone.has(l.id) &&
          !gone.has(l.from.moduleId) &&
          !gone.has(l.to.moduleId),
      ),
      checks: scene.checks.filter((c) => !gone.has(c.moduleId)),
    },
  ]);
}

/** Copies modules a little way off, on top of everything, with the links between them;
 * copies of grouped modules form a group of their own. Returns the copies' ids. */
export function duplicate(
  work: Work,
  sceneId: string,
  ids: string[],
  offset: number,
): { edit: WorkEdit; ids: string[] } {
  const scene = sceneOf(work, sceneId);
  const taken = partIds(work),
    groups = new Set(scene.modules.flatMap((m) => (m.group ? [m.group] : []))),
    copyOf = new Map<string, string>(),
    groupOf = new Map<string, string>();
  const copies = scene.modules
    .filter((m) => ids.includes(m.id))
    .map((m) => {
      const id = fresh(m.id, taken);
      taken.add(id);
      copyOf.set(m.id, id);
      let group = m.group;
      if (group) {
        if (!groupOf.has(group)) {
          const g = fresh(group, groups);
          groups.add(g);
          groupOf.set(group, g);
        }
        group = groupOf.get(group)!;
      }
      return {
        ...structuredClone(m),
        id,
        group,
        bounds: { ...m.bounds, x: m.bounds.x + offset, y: m.bounds.y + offset },
      };
    });
  const links = scene.links
    .filter((l) => copyOf.has(l.from.moduleId) && copyOf.has(l.to.moduleId))
    .map((l) => {
      const id = fresh(l.id, taken);
      taken.add(id);
      return {
        ...structuredClone(l),
        id,
        from: { ...l.from, moduleId: copyOf.get(l.from.moduleId)! },
        to: { ...l.to, moduleId: copyOf.get(l.to.moduleId)! },
      };
    });
  return {
    edit: edit(work, [
      {
        ...scene,
        modules: [...scene.modules, ...copies],
        links: [...scene.links, ...links],
      },
    ]),
    ids: copies.map((c) => c.id),
  };
}

/** Brings modules in front of all the others, or sends them behind, keeping their order
 * among themselves. */
export function arrange(
  work: Work,
  sceneId: string,
  ids: string[],
  to: "front" | "back",
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const moving = scene.modules.filter((m) => ids.includes(m.id)),
    rest = scene.modules.filter((m) => !ids.includes(m.id));
  return edit(work, [
    {
      ...scene,
      modules: to === "front" ? [...rest, ...moving] : [...moving, ...rest],
    },
  ]);
}

/** A module a person adds: words in the work's type, or a picture from the library. */
export type Addition =
  | { kind: "text"; text: string; size: number }
  | {
      kind: "picture";
      material: string;
      name: string;
      /** The picture's visible height for each unit of width. */
      aspect: number;
      width: number;
    };
/** The library drawing an addition is drawn with. */
export const drawingFor = (kind: Addition["kind"]) =>
  kind === "text" ? "label" : "picture";
/** Whether the work has a drawing of its own under the id of the library drawing an
 * addition is drawn with, so the addition needs a copy of the library's. */
export const shadowed = (work: Work, kind: Addition["kind"]) =>
  !!work.drawings[drawingFor(kind)];
/** Adds a module centred on a point, on top of everything, drawn with the library's
 * drawing for it, or with a copy of that drawing the work takes under an id of its own
 * when its own drawings already use the library's. Returns the module's id. */
export function add(
  work: Work,
  sceneId: string,
  at: { x: number; y: number },
  what: Addition,
  copy?: Omit<Drawing, "id">,
): { edit: WorkEdit; id: string } {
  const scene = sceneOf(work, sceneId);
  const taken = partIds(work);
  const drawing = copy && {
    ...copy,
    id: fresh(
      drawingFor(what.kind),
      new Set([...Object.keys(work.drawings), ...Object.keys(work.materials)]),
    ),
  };
  const [width, height] =
    what.kind === "text"
      ? [
          Math.max(8, [...what.text].length + 4) * what.size * 0.9,
          what.size * 2.2,
        ]
      : [what.width, what.width * what.aspect];
  const module: Instance = {
    id: fresh(what.kind, taken),
    label: what.kind === "text" ? what.text : what.name,
    bounds: { x: at.x - width / 2, y: at.y - height / 2, width, height },
    drawingId: drawing?.id ?? drawingFor(what.kind),
    group: null,
    target: null,
    anchors: {},
    data:
      what.kind === "text"
        ? { text: what.text, size: what.size }
        : { material: what.material },
  };
  return {
    edit: edit(work, [{ ...scene, modules: [...scene.modules, module] }], {
      ...(what.kind === "picture" ? { materials: [what.material] } : {}),
      ...(drawing ? { drawings: [drawing] } : {}),
    }),
    id: module.id,
  };
}

const escapeJs = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/[`'"]/g, "\\$&")
    .replace(/\$\{/g, "\\${")
    .replace(/\n/g, "\\n");
const escapeXml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const occurrences = (source: string, s: string) =>
  s ? source.split(s).length - 1 : 0;
/** Whether code still parses, so a replacement never leaves a drawing broken. */
function compiles(source: string) {
  try {
    new Function("api", `return (async()=>{${source}\n})()`);
    return true;
  } catch {
    return false;
  }
}
/** A data value with one string in it replaced: the whole string, or one of its lines.
 * `named` when it was the whole of an entry's name, which other entries may refer to it by. */
function replaceIn(
  value: unknown,
  from: string,
  to: string,
  key?: string,
): { value: unknown; done: boolean; named?: boolean } {
  if (typeof value === "string") {
    if (value === from) return { value: to, done: true, named: key === "name" };
    const lines = value.split("\n");
    const i = lines.indexOf(from);
    if (i >= 0 && lines.length > 1) {
      lines[i] = to;
      return { value: lines.join("\n"), done: true };
    }
    return { value, done: false };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = replaceIn(value[i], from, to);
      if (r.done) return { ...r, value: value.with(i, r.value) };
    }
    return { value, done: false };
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const r = replaceIn(v, from, to, k);
      if (r.done) return { ...r, value: { ...value, [k]: r.value } };
    }
  }
  return { value, done: false };
}
/** Every string in a data value that is exactly `from`, as `to`. */
function replaceAll(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) return value.map((v) => replaceAll(v, from, to));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceAll(v, from, to)]),
    );
  return value;
}

/** Changes words or a picture a person pointed at in a module to what they chose. The
 * module's own data is changed when it holds them; otherwise the module's drawing code,
 * when it names them exactly once. A drawing other modules share is copied for this one
 * first, so only what was pointed at changes. Null when they come from neither, such as
 * words a drawing composes or a library drawing writes itself. */
export function replace(
  work: Work,
  sceneId: string,
  moduleId: string,
  kind: "text" | "picture",
  from: string,
  to: string,
): WorkEdit | null {
  if (from === to) return null;
  const scene = sceneOf(work, sceneId);
  const module = scene.modules.find((m) => m.id === moduleId);
  if (!module) return null;
  const extra: Partial<WorkEdit> =
    kind === "picture" ? { materials: [to] } : {};
  // A label that is the words themselves follows them.
  const label = kind === "text" && module.label === from ? to : module.label;
  const first = replaceIn(module.data, from, to);
  // A renamed entry (a place on a map) takes the references to it along: routes and
  // areas that list it by name would otherwise lose it.
  const inData = first.named
    ? { ...first, value: replaceAll(first.value, from, to) }
    : first;
  if (inData.done)
    return edit(
      work,
      [
        {
          ...scene,
          modules: scene.modules.map((m) =>
            m.id === moduleId
              ? { ...m, label, data: inData.value as Instance["data"] }
              : m,
          ),
        },
      ],
      extra,
    );
  const drawing = work.drawings[module.drawingId];
  if (!drawing) return null;
  const forms =
    kind === "picture"
      ? [`"${from}"`, `'${from}'`, `\`${from}\``]
      : [...new Set([from, escapeXml(from)])];
  const found = forms.filter((f) => occurrences(drawing.source, f) > 0);
  if (found.length !== 1 || occurrences(drawing.source, found[0]) !== 1)
    return null;
  const at = drawing.source.indexOf(found[0]);
  const markup =
    /^\s*$/.test(drawing.source.slice(0, at).split(">").at(-1)!) &&
    /^\s*</.test(drawing.source.slice(at + found[0].length));
  const written =
    kind === "picture"
      ? found[0][0] + to + found[0][0]
      : escapeJs(markup ? escapeXml(to) : to);
  const source =
    drawing.source.slice(0, at) +
    written +
    drawing.source.slice(at + found[0].length);
  if (!compiles(source)) return null;
  const shared = Object.values(work.scenes).some((s) =>
    [...s.modules, ...s.links].some(
      (p) => p.drawingId === drawing.id && p.id !== moduleId,
    ),
  );
  const changed: Drawing = shared
    ? {
        ...drawing,
        id: fresh(
          drawing.id,
          new Set([
            ...Object.keys(work.drawings),
            ...Object.keys(work.materials),
          ]),
        ),
        source,
      }
    : { ...drawing, source };
  return edit(
    work,
    [
      {
        ...scene,
        modules: scene.modules.map((m) =>
          m.id === moduleId ? { ...m, label, drawingId: changed.id } : m,
        ),
      },
    ],
    { ...extra, drawings: [changed] },
  );
}

/** Whether two values hold the same, whatever order their keys were written in. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as any)[k] !== undefined),
    kb = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => same((a as any)[k], (b as any)[k]))
  );
}
/** What changed in a work between two of its revisions: per scene, the parts added,
 * removed, changed in what they show, and only moved or resized; and whether its shared
 * style changed. */
export function changesBetween(before: Work, after: Work) {
  const scenes = Object.values(after.scenes).flatMap((scene) => {
    const was = before.scenes[scene.id];
    const old = new Map(
      [...(was?.modules ?? []), ...(was?.links ?? [])].map((p) => [p.id, p]),
    );
    const now = [...scene.modules, ...scene.links];
    const ids = new Set(now.map((p) => p.id));
    const source = (w: Work, p: Instance | Link) =>
      w.drawings[p.drawingId]?.source;
    const added: string[] = [],
      changed: string[] = [],
      moved: string[] = [];
    for (const p of now) {
      const o = old.get(p.id);
      if (!o) added.push(p.id);
      else if (
        !same({ ...o, bounds: null }, { ...p, bounds: null }) ||
        source(before, o) !== source(after, p)
      )
        changed.push(p.id);
      else if ("bounds" in p && !same(p.bounds, (o as Instance).bounds))
        moved.push(p.id);
    }
    const removed = [...old.keys()].filter((id) => !ids.has(id));
    // Stacking order is part of the composition too.
    const order = (s?: Scene) =>
      s?.modules
        .map((m) => m.id)
        .filter((id) => ids.has(id) && old.has(id))
        .join();
    const restacked = !!was && order(was) !== order(scene);
    return added.length ||
      removed.length ||
      changed.length ||
      moved.length ||
      restacked
      ? [{ id: scene.id, added, removed, changed, moved, restacked }]
      : [];
  });
  return {
    scenes,
    style: !same(before.style, after.style),
  };
}
