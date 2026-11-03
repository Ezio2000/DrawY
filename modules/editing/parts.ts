import type {
  Bounds,
  Drawing,
  Instance,
  Link,
  Target,
  Work,
  WorkEdit,
} from "../contracts/index.ts";
import { instanceSchema } from "../contracts/index.ts";
import { drawingIds, edit, fresh, partIds, sceneOf } from "./shared.ts";

/* Hand edits to the parts of a scene: their values, places, names, stacking, groups and
 * where they lead, and adding, copying and taking them out. */

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
/** Puts modules where they were dragged, nudged, aligned or typed in. */
export function moveParts(
  work: Work,
  sceneId: string,
  moves: { id: string; bounds: Bounds }[],
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const to = new Map(moves.map((m) => [m.id, tidy(m.bounds)]));
  return edit(work, [
    {
      ...scene,
      modules: scene.modules.map((m) =>
        to.has(m.id) ? { ...m, bounds: { ...to.get(m.id)! } } : m,
      ),
    },
  ]);
}

/** Changes what a module is called: the name the author and the layers list know it by. */
export function rename(
  work: Work,
  sceneId: string,
  moduleId: string,
  label: string,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  return edit(work, [
    {
      ...scene,
      modules: scene.modules.map((m) =>
        m.id === moduleId ? { ...m, label } : m,
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

/** Where modules go in the stacking order: in front of all the others or behind them,
 * one step forward or back past the next module they overlap, or to a place in the list. */
export type Stacking = "front" | "back" | "forward" | "backward";
const overlap = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
/** Restacks modules, keeping their order among themselves. A step forward passes the next
 * module above that they overlap, so the step shows; with none, they stay. */
export function arrange(
  work: Work,
  sceneId: string,
  ids: string[],
  to: Stacking,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const chosen = new Set(ids);
  const moving = scene.modules.filter((m) => chosen.has(m.id)),
    rest = scene.modules.filter((m) => !chosen.has(m.id));
  if (to === "front" || to === "back")
    return edit(work, [
      {
        ...scene,
        modules: to === "front" ? [...rest, ...moving] : [...moving, ...rest],
      },
    ]);
  // Step past the nearest module above (or below) the chosen ones that any of them covers.
  const order = scene.modules;
  const positions = order.flatMap((m, i) => (chosen.has(m.id) ? [i] : []));
  if (!positions.length) return edit(work, [scene]);
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
  if (!pass) return edit(work, [scene]);
  const at = rest.indexOf(pass);
  const modules =
    to === "forward"
      ? [...rest.slice(0, at + 1), ...moving, ...rest.slice(at + 1)]
      : [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return edit(work, [{ ...scene, modules }]);
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
  const modules =
    at < 0
      ? [...rest, ...moving]
      : [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return edit(work, [{ ...scene, modules }]);
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
    edit: edit(work, [
      {
        ...scene,
        modules: scene.modules.map((m) =>
          ids.includes(m.id) || (m.group && joined.has(m.group))
            ? { ...m, group: id }
            : m,
        ),
      },
    ]),
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
  return edit(work, [
    {
      ...scene,
      modules: scene.modules.map((m) =>
        m.group && groups.has(m.group) ? { ...m, group: null } : m,
      ),
    },
  ]);
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
  const scene = sceneOf(work, sceneId);
  return edit(work, [
    {
      ...scene,
      modules: scene.modules.map((m) =>
        ids.includes(m.id) ? { ...m, target } : m,
      ),
    },
  ]);
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
  return edit(
    work,
    [
      {
        ...scene,
        modules: scene.modules.map((m) =>
          ids.includes(m.id) ? { ...m, drawingId } : m,
        ),
        links: scene.links.map((l) =>
          ids.includes(l.id) ? { ...l, drawingId } : l,
        ),
      },
    ],
    work.drawings[drawingId] ? {} : { materials: [drawingId] },
  );
}

/** Replaces a module with a record written out in full, as the author writes one. Its id
 * stays, so links and checks keep finding it; a record that is not a module is refused. */
export function setModule(
  work: Work,
  sceneId: string,
  moduleId: string,
  record: unknown,
): WorkEdit {
  const scene = sceneOf(work, sceneId);
  const parsed = instanceSchema.safeParse({
    ...(record as object),
    id: moduleId,
  });
  if (!parsed.success)
    throw Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "module"}: ${i.message}`)
        .join("; "),
    );
  return edit(
    work,
    [
      {
        ...scene,
        modules: scene.modules.map((m) =>
          m.id === moduleId ? parsed.data : m,
        ),
      },
    ],
    work.drawings[parsed.data.drawingId]
      ? {}
      : { materials: [parsed.data.drawingId] },
  );
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
  const scene = sceneOf(work, sceneId);
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
    label: what.kind === "text" ? what.text : what.name,
    bounds: { x: at.x - width / 2, y: at.y - height / 2, width, height },
    drawingId: drawing?.id ?? library,
    group: null,
    target: null,
    anchors: {},
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
    edit: edit(work, [{ ...scene, modules: [...scene.modules, module] }], {
      ...(materials.length ? { materials } : {}),
      ...(drawing ? { drawings: [drawing] } : {}),
    }),
    id: module.id,
  };
}
