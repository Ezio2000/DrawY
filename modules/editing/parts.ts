import type {
  Bounds,
  Drawing,
  Instance,
  Link,
  ModuleEdit,
  Target,
  Work,
  WorkEdit,
} from "../contracts/index.ts";
import { boxOf, boxSchema, diffValue, instanceSchema } from "../contracts/index.ts";
import { drawingIds, fresh, partIds, sceneOf } from "./shared.ts";

/* Hand edits to the parts of a scene: their values, places, names, stacking, groups and
 * where they lead, and adding, copying and taking them out. Each says only what it changes. */

/** The part an id means in a scene. */
const partIn = (work: Work, sceneId: string, id: string): Instance | Link | undefined => {
  const scene = sceneOf(work, sceneId);
  return scene.modules.find((m) => m.id === id) ?? scene.links.find((l) => l.id === id);
};
const isLink = (part: Instance | Link): part is Link => "from" in part;
/** Changes some of a part's values; undefined gives a value back to its drawing's default.
 * Pictures it now shows are named so the work takes them in. */
export function setData(
  work: Work,
  sceneId: string,
  partId: string,
  patch: Record<string, unknown>,
  pictures: string[] = [],
): WorkEdit {
  const part = partIn(work, sceneId, partId);
  const after: Record<string, unknown> = { ...part?.data, ...patch };
  const data = diffValue(part?.data ?? {}, after);
  const change = { id: partId, scene: sceneId, data };
  return {
    ...(part && isLink(part) ? { links: [change] } : { modules: [change] }),
    ...(pictures.length ? { materials: pictures } : {}),
  };
}

/** A place in scene units to the hundredth: a drag lands between pixels, and the author
 * reads these numbers. */
const tidy = (b: Bounds): Bounds => {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    x: r(b.x),
    y: r(b.y),
    width: Math.max(0.01, r(b.width)),
    height: Math.max(0.01, r(b.height)),
  };
};
/** The same change to several modules of a scene. */
const eachModule = (
  sceneId: string,
  ids: string[],
  change: Omit<ModuleEdit, "id" | "scene">,
): WorkEdit => ({ modules: ids.map((id) => ({ id, scene: sceneId, ...change })) });
/** Puts modules where they were dragged, nudged, aligned or typed in. */
export function moveParts(
  work: Work,
  sceneId: string,
  moves: { id: string; bounds: Bounds }[],
): WorkEdit {
  sceneOf(work, sceneId);
  return {
    modules: moves.map((m) => ({ id: m.id, scene: sceneId, bounds: boxOf(tidy(m.bounds)) })),
  };
}

/** Changes what a module is called: the name the author and the layers list know it by.
 * Left empty, it goes back to being called by its words. */
export function rename(
  work: Work,
  sceneId: string,
  moduleId: string,
  label: string,
): WorkEdit {
  sceneOf(work, sceneId);
  return eachModule(sceneId, [moduleId], { label: label.trim() || null });
}

/** Takes modules and links out of a scene, with the links and checks that need them. */
export function removeParts(work: Work, sceneId: string, ids: string[]): WorkEdit {
  const scene = sceneOf(work, sceneId);
  return {
    remove: {
      modules: scene.modules.filter((m) => ids.includes(m.id)).map((m) => m.id),
      links: scene.links.filter((l) => ids.includes(l.id)).map((l) => l.id),
    },
  };
}

/** A part as an edit writes it new. */
export const newModule = (sceneId: string, m: Instance): ModuleEdit => {
  const { bounds, ...rest } = m;
  return { ...rest, scene: sceneId, bounds: boxOf(bounds) };
};
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
        ...(group ? { group } : {}),
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
        scene: sceneId,
        from: { ...l.from, moduleId: copyOf.get(l.from.moduleId)! },
        to: { ...l.to, moduleId: copyOf.get(l.to.moduleId)! },
      };
    });
  return {
    edit: {
      modules: copies.map((c) => newModule(sceneId, c)),
      ...(links.length ? { links } : {}),
    },
    ids: copies.map((c) => c.id),
  };
}

/** Where modules go in the stacking order: in front of all the others or behind them,
 * one step forward or back past the next module they overlap, or to a place in the list. */
export type Stacking = "front" | "back" | "forward" | "backward";
const overlap = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
/** The modules of a scene in a new order, as an edit. */
const inOrder = (sceneId: string, modules: Instance[]): WorkEdit => ({
  scenes: [{ id: sceneId, order: modules.map((m) => m.id) }],
});
/** Restacks modules, keeping their order among themselves. A step forward passes the next
 * module above that they overlap, so the step shows; with none, nothing changes. */
export function arrange(
  work: Work,
  sceneId: string,
  ids: string[],
  to: Stacking,
): WorkEdit | null {
  const scene = sceneOf(work, sceneId);
  const chosen = new Set(ids);
  const moving = scene.modules.filter((m) => chosen.has(m.id)),
    rest = scene.modules.filter((m) => !chosen.has(m.id));
  if (to === "front" || to === "back")
    return inOrder(sceneId, to === "front" ? [...rest, ...moving] : [...moving, ...rest]);
  // Step past the nearest module above (or below) the chosen ones that any of them covers.
  const order = scene.modules;
  const positions = order.flatMap((m, i) => (chosen.has(m.id) ? [i] : []));
  if (!positions.length) return null;
  const covers = (m: Instance) => moving.some((c) => overlap(c.bounds, m.bounds));
  let pass: Instance | undefined;
  if (to === "forward") {
    const top = Math.max(...positions);
    pass =
      order.slice(top + 1).find((m) => !chosen.has(m.id) && covers(m)) ??
      order.slice(top + 1).find((m) => !chosen.has(m.id));
  } else {
    const bottom = Math.min(...positions);
    pass =
      order
        .slice(0, bottom)
        .reverse()
        .find((m) => !chosen.has(m.id) && covers(m)) ??
      order
        .slice(0, bottom)
        .reverse()
        .find((m) => !chosen.has(m.id));
  }
  if (!pass) return null;
  const at = rest.indexOf(pass);
  return inOrder(
    sceneId,
    to === "forward"
      ? [...rest.slice(0, at + 1), ...moving, ...rest.slice(at + 1)]
      : [...rest.slice(0, at), ...moving, ...rest.slice(at)],
  );
}
/** Puts modules at a place in the stacking order, as dragged in the layers list: before
 * the module `before` (drawn under it), or on top when there is none. */
export function restack(
  work: Work,
  sceneId: string,
  ids: string[],
  before: string | null,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const chosen = new Set(ids);
  const moving = scene.modules.filter((m) => chosen.has(m.id)),
    rest = scene.modules.filter((m) => !chosen.has(m.id));
  const at = before ? rest.findIndex((m) => m.id === before) : -1;
  return inOrder(
    sceneId,
    at < 0 ? [...rest, ...moving] : [...rest.slice(0, at), ...moving, ...rest.slice(at)],
  );
}

/** Makes modules one group, which moves together; any groups they were in are left for
 * the new one. Returns the group's id. */
export function group(
  work: Work,
  sceneId: string,
  ids: string[],
): { edit: WorkEdit; group: string } {
  const scene = sceneOf(work, sceneId);
  const taken = new Set(
    Object.values(work.scenes).flatMap((s) =>
      s.modules.flatMap((m) => (m.group ? [m.group] : [])),
    ),
  );
  const id = fresh("group", taken);
  // The whole of every group touched joins, so no group is left with one member apart.
  const joined = new Set(
    scene.modules
      .filter((m) => ids.includes(m.id))
      .flatMap((m) => (m.group ? [m.group] : [])),
  );
  return {
    edit: eachModule(
      sceneId,
      scene.modules
        .filter((m) => ids.includes(m.id) || (m.group && joined.has(m.group)))
        .map((m) => m.id),
      { group: id },
    ),
    group: id,
  };
}
/** Takes the groups of these modules apart; each member moves on its own again. */
export function ungroup(work: Work, sceneId: string, ids: string[]): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const groups = new Set(
    scene.modules
      .filter((m) => ids.includes(m.id))
      .flatMap((m) => (m.group ? [m.group] : [])),
  );
  return eachModule(
    sceneId,
    scene.modules.filter((m) => m.group && groups.has(m.group)).map((m) => m.id),
    { group: null },
  );
}
/** The modules a group holds. */
export const membersOf = (work: Work, sceneId: string, group: string) =>
  sceneOf(work, sceneId)
    .modules.filter((m) => m.group === group)
    .map((m) => m.id);

/** Where a click on a module leads: into a scene, into a detail, or nowhere. */
export function setTarget(
  work: Work,
  sceneId: string,
  ids: string[],
  target: Target | null,
): WorkEdit {
  sceneOf(work, sceneId);
  return eachModule(sceneId, ids, { target });
}

/** Draws modules with another drawing: one of the work's own or a library drawing, which
 * the work then takes in. Their data stays as it is. */
export function useDrawing(
  work: Work,
  sceneId: string,
  ids: string[],
  drawingId: string,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const modules = scene.modules.filter((m) => ids.includes(m.id)),
    links = scene.links.filter((l) => ids.includes(l.id));
  return {
    ...(modules.length
      ? { modules: modules.map((m) => ({ id: m.id, scene: sceneId, drawingId })) }
      : {}),
    ...(links.length
      ? { links: links.map((l) => ({ id: l.id, scene: sceneId, drawingId })) }
      : {}),
    ...(work.drawings[drawingId] ? {} : { materials: [drawingId] }),
  };
}

/** A module written out in full, in the terms the author reads and writes it: its box in
 * short form, and what it has by default left out. */
export const moduleRecord = ({ id: _, bounds, ...m }: Instance) => ({ ...m, bounds: boxOf(bounds) });
const recordSchema = instanceSchema
  .omit({ id: true, bounds: true })
  .extend({ bounds: boxSchema })
  .strict();
/** Changes a module to a record written out in full. Its id stays, so links and checks keep
 * finding it; what the record leaves out goes, and a record that is not a module is refused. */
export function setModule(
  work: Work,
  sceneId: string,
  moduleId: string,
  record: unknown,
): WorkEdit {
  const m = sceneOf(work, sceneId).modules.find((x) => x.id === moduleId);
  if (!m) throw Error("模块不存在");
  const parsed = recordSchema.safeParse(record);
  if (!parsed.success)
    throw Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "module"}: ${i.message}`)
        .join("; "),
    );
  const { label, bounds, drawingId, group, target, data } = parsed.data;
  return {
    modules: [
      {
        id: moduleId,
        scene: sceneId,
        label: label ?? null,
        bounds,
        drawingId,
        group: group ?? null,
        target: target ?? null,
        data: diffValue(m.data, data),
      },
    ],
    ...(work.drawings[drawingId] ? {} : { materials: [drawingId] }),
  };
}

/** A module a person adds: words in the work's type, a picture from the library, or a
 * library drawing (a shape, a chart, a diagram) with the data that shows it. */
export type Addition =
  | { kind: "text"; text: string; size: number }
  | {
      kind: "picture";
      material: string;
      name: string;
      /** The picture's visible height for each unit of width. */
      aspect: number;
      width: number;
    }
  | {
      kind: "drawing";
      material: string;
      name: string;
      size: { width: number; height: number };
      data: Record<string, unknown>;
    };
/** The library drawing an addition is drawn with. */
export const drawingFor = (what: Addition | Addition["kind"]) => {
  const kind = typeof what === "string" ? what : what.kind;
  return kind === "text"
    ? "label"
    : kind === "picture"
      ? "picture"
      : (what as Extract<Addition, { kind: "drawing" }>).material;
};
/** Whether the work has a drawing of its own under the id of the library drawing an
 * addition is drawn with, so the addition needs a copy of the library's. */
export const shadowed = (work: Work, what: Addition | Addition["kind"]) =>
  !!work.drawings[drawingFor(what)];
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
  sceneOf(work, sceneId);
  const taken = partIds(work);
  const library = drawingFor(what);
  const drawing = copy && {
    ...copy,
    id: fresh(library, drawingIds(work)),
  };
  const [width, height] =
    what.kind === "text"
      ? [
          Math.max(8, [...what.text].length + 4) * what.size * 0.9,
          what.size * 2.2,
        ]
      : what.kind === "picture"
        ? [what.width, what.width * what.aspect]
        : [what.size.width, what.size.height];
  const module: Instance = {
    id: fresh(what.kind === "drawing" ? what.material : what.kind, taken),
    ...(what.kind === "text" ? {} : { label: what.name }),
    bounds: { x: at.x - width / 2, y: at.y - height / 2, width, height },
    drawingId: drawing?.id ?? library,
    data:
      what.kind === "text"
        ? { text: what.text, size: what.size }
        : what.kind === "picture"
          ? { material: what.material }
          : structuredClone(what.data),
  };
  const materials = [
    ...(what.kind === "picture" ? [what.material] : []),
    ...(!drawing && what.kind === "drawing" ? [library] : []),
  ];
  return {
    edit: {
      modules: [newModule(sceneId, module)],
      ...(materials.length ? { materials } : {}),
      ...(drawing ? { drawings: [drawing] } : {}),
    },
    id: module.id,
  };
}
