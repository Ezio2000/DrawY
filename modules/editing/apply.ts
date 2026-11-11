import {
  boundsOf,
  drawingOf,
  editedText,
  EditRejected,
  mergeRecord,
  mergeValue,
  workEditSchema,
  type Drawing,
  type DrawingEdit,
  type LinkEdit,
  type LinkEnd,
  type ModuleEdit,
  type Problem,
  type Scene,
  type SceneEdit,
  type Work,
  type WorkEdit,
} from "../contracts/index.ts";

/* An edit laid on a work, for both the workspace that commits it and the page that shows a
 * hand edit before the workspace has answered, so both lay it the same way. Everything wrong
 * with an edit is found in one pass, because one correction should settle them all. */

const asEnd = (end: string | LinkEnd): LinkEnd =>
  typeof end === "string" ? { moduleId: end } : end;

/** The scene a part with a known id is in: the scene it names, the current one or any. */
function holder(
  work: Work,
  part: "modules" | "links",
  id: string,
  current: string,
) {
  const has = (s?: Scene) => !!s?.[part].some((p) => p.id === id);
  if (has(work.scenes[current])) return work.scenes[current];
  return Object.values(work.scenes).find(has);
}
/** Every scene below one. */
function below(work: Work, sceneId: string): string[] {
  return Object.values(work.scenes)
    .filter((s) => s.parentId === sceneId)
    .flatMap((s) => [s.id, ...below(work, s.id)]);
}
/** Takes out what an edit removes, with whatever could not stand without it. Going first, it
 * lets the same write recreate a part under the id it removed. */
function removal(
  work: Work,
  remove: NonNullable<WorkEdit["remove"]>,
  current: string,
  problems: Problem[],
) {
  const drop = (part: "modules" | "links", id: string) => {
    const scene = holder(work, part, id, current);
    if (!scene) return false;
    if (part === "modules") {
      scene.modules = scene.modules.filter((m) => m.id !== id);
      scene.links = scene.links.filter(
        (l) => l.from.moduleId !== id && l.to.moduleId !== id,
      );
      scene.checks = scene.checks.filter((c) => c.moduleId !== id);
    } else scene.links = scene.links.filter((l) => l.id !== id);
    return true;
  };
  const absent: string[] = [];
  for (const id of remove.modules ?? [])
    if (!drop("modules", id)) absent.push(id);
  for (const id of remove.links ?? []) if (!drop("links", id)) absent.push(id);
  for (const id of remove.drawings ?? []) {
    if (!work.drawings[id]) absent.push(id);
    delete work.drawings[id];
  }
  const lost = (kind: "scene" | "detail", ids: Set<string>) => {
    for (const scene of Object.values(work.scenes))
      for (const m of scene.modules)
        if (m.target?.kind === kind && ids.has(m.target.id)) delete m.target;
  };
  const scenes = new Set<string>();
  for (const id of remove.scenes ?? []) {
    if (!work.scenes[id]) absent.push(id);
    else if (id === work.rootSceneId)
      problems.push({ at: `remove.scenes.${id}`, problem: "根场景不能删除" });
    else [id, ...below(work, id)].forEach((s) => scenes.add(s));
  }
  for (const id of scenes) delete work.scenes[id];
  lost("scene", scenes);
  for (const id of remove.details ?? []) {
    if (!work.details[id]) absent.push(id);
    delete work.details[id];
  }
  lost("detail", new Set(remove.details ?? []));
  for (const id of remove.materials ?? []) delete work.materials[id];
  return absent;
}
function sceneChange(
  work: Work,
  edit: SceneEdit,
  current: string,
  problems: Problem[],
) {
  const at = `scenes.${edit.id}`;
  let scene = work.scenes[edit.id];
  if (!scene) {
    if (edit.title === undefined)
      problems.push({
        at: `${at}.title`,
        problem: `场景 ${edit.id} 是新的，要给 title`,
      });
    scene = work.scenes[edit.id] = {
      id: edit.id,
      title: edit.title ?? edit.id,
      parentId: edit.parentId ?? current,
      modules: [],
      links: [],
      checks: [],
    };
  }
  if (edit.title !== undefined) scene.title = edit.title;
  if (edit.parentId !== undefined) scene.parentId = edit.parentId;
  if (edit.clear) {
    scene.modules = [];
    scene.links = [];
    scene.checks = [];
  }
  if (edit.checks) scene.checks = structuredClone(edit.checks);
  if (edit.interaction === null) delete scene.interaction;
  else if (edit.interaction !== undefined) scene.interaction = edit.interaction;
  if (edit.interactionEdits?.length) {
    if (scene.interaction === undefined)
      problems.push({
        at: `${at}.interactionEdits`,
        problem: `场景 ${edit.id} 还没有交互脚本，用 interaction 写整段`,
      });
    else
      scene.interaction = editedText(
        scene.interaction,
        edit.interactionEdits,
        `${at}.interactionEdits`,
        problems,
      );
  }
}
function moduleChange(
  work: Work,
  edit: ModuleEdit,
  current: string,
  problems: Problem[],
) {
  const {
    id,
    scene: named,
    label,
    bounds,
    drawingId,
    group,
    target,
    data,
  } = edit;
  const at = `modules.${id}`;
  const scene = holder(work, "modules", id, named ?? current);
  if (scene && named && scene.id !== named)
    return void problems.push({
      at: `${at}.scene`,
      problem: `模块 ${id} 已在场景 ${scene.id} 里：模块 ID 在整个作品里不重复，要放到 ${named} 就换一个 ID`,
    });
  let m = scene?.modules.find((x) => x.id === id);
  if (!m) {
    const missing = [!bounds && "bounds", !drawingId && "drawingId"].filter(
      Boolean,
    );
    if (missing.length)
      return void problems.push({
        at,
        problem: `模块 ${id} 是新增的，要给全 ${missing.join("、")}（已有的模块里没有这个 ID${bounds ? "" : "；不给 bounds 时要有一条 arrange 来摆放它"}）`,
      });
    const where = named ?? endsIn(work, edit) ?? current;
    const home = work.scenes[where];
    if (!home)
      return void problems.push({
        at: `${at}.scene`,
        problem: `场景 ${where} 不存在：新场景写在 scenes 里`,
      });
    m = { id, bounds: boundsOf(bounds!), drawingId: drawingId!, data: {} };
    home.modules.push(m);
  }
  if (label === null || label === "") delete m.label;
  else if (label !== undefined) m.label = label;
  if (bounds) m.bounds = boundsOf(bounds);
  if (drawingId) m.drawingId = drawingId;
  if (group === null) delete m.group;
  else if (group !== undefined) m.group = group;
  if (target === null) delete m.target;
  else if (target !== undefined) m.target = target;
  if (data) m.data = mergeRecord(m.data, data, `${at}.data`, problems);
}
/** The module an end is on, as an edit writes it. */
const endOf = (end: string | LinkEnd | undefined) =>
  typeof end === "string" ? end : end?.moduleId;
/** What an edit calls a link it gives no id: its two ends. */
// Not the id it would be given: module ids hold hyphens, so "api-gateway" to "db" and "api"
// to "gateway-db" would be taken for one link.
export const linkKey = (l: Pick<LinkEdit, "from" | "to">) =>
  JSON.stringify([endOf(l.from), endOf(l.to)]);
/** Every id a part of the work answers to. */
const partIds = (work: Work) =>
  new Set(
    Object.values(work.scenes).flatMap((s) =>
      [...s.modules, ...s.links].map((p) => p.id),
    ),
  );
/** The id of a link written without one: that of the one link already between its two ends
 * in its scene, so writing it again changes it, or else one made from the ends. */
function linkId(work: Work, edit: LinkEdit, current: string) {
  const a = endOf(edit.from),
    b = endOf(edit.to);
  if (!a || !b) return undefined;
  const between = (
    work.scenes[edit.scene ?? endsIn(work, edit) ?? current]?.links ?? []
  ).filter((l) => l.from.moduleId === a && l.to.moduleId === b);
  if (between.length === 1) return between[0].id;
  const taken = partIds(work);
  let id = `${a}-${b}`;
  for (let n = 2; taken.has(id); n++) id = `${a}-${b}-${n}`;
  return id;
}
/** The scene both modules a link names stand in, where they stand in one: a new link written
 * without a scene goes there, so the links of a scene written with its modules need no scene
 * of their own. */
function endsIn(work: Work, edit: LinkEdit) {
  const a = endOf(edit.from),
    b = endOf(edit.to);
  if (!a || !b) return undefined;
  const has = (id: string) =>
    Object.values(work.scenes).find((s) => s.modules.some((m) => m.id === id))
      ?.id;
  const sa = has(a);
  return sa && sa === has(b) ? sa : undefined;
}
function linkChange(
  work: Work,
  edit: LinkEdit,
  current: string,
  problems: Problem[],
) {
  const { drawingId, from, to, data } = edit;
  const named = edit.scene;
  const id = edit.id ?? linkId(work, edit, current);
  if (!id)
    return void problems.push({
      at: "links",
      problem: "连线没有 id 时要给全 from、to：它靠两端认出是哪一条",
    });
  const at = `links.${id}`;
  const scene = holder(work, "links", id, named ?? current);
  if (scene && named && scene.id !== named)
    return void problems.push({
      at: `${at}.scene`,
      problem: `连线 ${id} 已在场景 ${scene.id} 里：连线 ID 在整个作品里不重复，要放到 ${named} 就换一个 ID`,
    });
  let l = scene?.links.find((x) => x.id === id);
  if (!l) {
    const missing = [!from && "from", !to && "to"].filter(Boolean);
    if (missing.length)
      return void problems.push({
        at,
        problem: `连线 ${id} 是新增的，要给全 ${missing.join("、")}（已有的连线里没有这个 ID）`,
      });
    const where = named ?? endsIn(work, edit) ?? current;
    const home = work.scenes[where];
    if (!home)
      return void problems.push({
        at: `${at}.scene`,
        problem: `场景 ${where} 不存在：新场景写在 scenes 里`,
      });
    l = {
      id,
      drawingId: drawingId ?? "arrow",
      from: asEnd(from!),
      to: asEnd(to!),
      data: {},
    };
    home.links.push(l);
  }
  if (drawingId) l.drawingId = drawingId;
  if (from) l.from = asEnd(from);
  if (to) l.to = asEnd(to);
  if (data) l.data = mergeRecord(l.data, data, `${at}.data`, problems);
}
function drawingChange(work: Work, edit: DrawingEdit, problems: Problem[]) {
  const { id, from, name, params, defaults, size, fit, source, edits } = edit;
  const at = `drawings.${id}`;
  let drawing = work.drawings[id];
  if (!drawing) {
    const origin = from ? drawingOf(work, from) : undefined;
    if (from && !origin)
      return void problems.push({
        at: `${at}.from`,
        problem: `画法 ${id} 要复制的 ${from} 不存在：在作品的 drawings 里，或者是库里的画法`,
      });
    if (!origin && source === undefined)
      return void problems.push({
        at,
        problem: `画法 ${id} 是新增的，要给 source，或者用 from 复制一个已有的画法`,
      });
    const keptParams: Drawing["params"] = origin
      ? structuredClone(origin.params)
      : {};
    const keptDefaults = origin ? structuredClone(origin.defaults) : {};
    drawing = work.drawings[id] = {
      id,
      name: name ?? origin?.name ?? id,
      ...(Object.keys(keptParams!).length ? { params: keptParams } : {}),
      ...(Object.keys(keptDefaults).length ? { defaults: keptDefaults } : {}),
      ...(origin?.size
        ? { size: [origin.size.width, origin.size.height] }
        : {}),
      ...(origin?.fit ? { fit: origin.fit } : {}),
      source: source ?? origin!.source,
    };
  }
  if (size) drawing.size = size;
  if (fit === null) delete drawing.fit;
  else if (fit) drawing.fit = fit;
  if (name !== undefined) drawing.name = name;
  if (params)
    drawing.params = mergeRecord(
      drawing.params ?? {},
      params,
      `${at}.params`,
      problems,
    ) as typeof drawing.params;
  if (defaults)
    drawing.defaults = mergeRecord(
      drawing.defaults ?? {},
      defaults,
      `${at}.defaults`,
      problems,
    );
  if (source !== undefined) drawing.source = source;
  if (edits?.length)
    drawing.source = editedText(drawing.source, edits, `${at}.edits`, problems);
}
/** The order of modules with those it names taking the places they already hold among them. */
function restacked(work: Work, edit: SceneEdit, problems: Problem[]) {
  const scene = work.scenes[edit.id];
  const places = new Map(scene.modules.map((m, i) => [m.id, i]));
  const unknown = edit.order!.filter((id) => !places.has(id));
  if (unknown.length)
    return void problems.push({
      at: `scenes.${edit.id}.order`,
      problem: `order 里的模块 ${unknown.join("、")} 不在场景 ${edit.id} 里`,
    });
  const slots = edit.order!.map((id) => places.get(id)!).sort((a, b) => a - b);
  const moved = edit.order!.map((id) => scene.modules[places.get(id)!]);
  slots.forEach((slot, i) => (scene.modules[slot] = moved[i]));
}
/** The work an edit leaves, what it could not remove because it was not there, and every
 * problem found laying it, each record that has one left out. `current` is the scene the
 * edit's new parts go in unless they name another. A title the user gave is the workspace's
 * to keep; materials the edit newly names are its to fetch. */
export function layOn(work: Work, edit: WorkEdit, current = work.rootSceneId) {
  const next = structuredClone(work);
  const problems: Problem[] = [];
  const absent = edit.remove
    ? removal(next, edit.remove, current, problems)
    : [];
  if (edit.title !== undefined) next.title = edit.title;
  for (const scene of edit.scenes ?? [])
    sceneChange(next, scene, current, problems);
  for (const m of edit.modules ?? []) moduleChange(next, m, current, problems);
  for (const l of edit.links ?? []) linkChange(next, l, current, problems);
  for (const d of edit.drawings ?? []) drawingChange(next, d, problems);
  for (const { id, title, html, edits } of edit.details ?? []) {
    const at = `details.${id}`;
    const was = next.details[id];
    if (!was && (title === undefined || html === undefined)) {
      problems.push({ at, problem: `详情 ${id} 是新增的，要给全 title、html` });
      continue;
    }
    const detail = (next.details[id] = {
      id,
      title: title ?? was.title,
      html: html ?? was.html,
    });
    if (edits?.length)
      detail.html = editedText(detail.html, edits, `${at}.edits`, problems);
  }
  for (const scene of edit.scenes ?? [])
    if (scene.order?.length && next.scenes[scene.id])
      restacked(next, scene, problems);
  if (edit.style)
    next.style = mergeValue(
      next.style,
      edit.style,
      "style",
      problems,
    ) as Work["style"];
  return { work: next, absent, problems };
}
/** The work an edit leaves, when only that matters. Throws `EditRejected` for an edit with
 * problems. */
export function applied(work: Work, edit: WorkEdit, current?: string) {
  const { work: next, problems } = layOn(work, edit, current);
  if (problems.length) throw new EditRejected(problems);
  return next;
}
/** Whether a work already holds every material an edit takes in, so the edit can be shown
 * before the workspace fetches anything: the materials it names, the drawings it copies, and
 * the drawing of every module and new link it lays (a library drawing the work has not used
 * yet, like the first label on a blank canvas, comes with the workspace's answer). */
export const showable = (work: Work, edit: WorkEdit) => {
  const drawn = (id: string) =>
    !!drawingOf(work, id) || (edit.drawings ?? []).some((d) => d.id === id);
  const links = Object.fromEntries(
    Object.values(work.scenes).flatMap((s) => s.links.map((l) => [l.id, l])),
  );
  return (
    (edit.materials ?? []).every((id) => !!work.materials[id]) &&
    (edit.drawings ?? []).every((d) => !d.from || !!drawingOf(work, d.from)) &&
    (edit.modules ?? []).every((m) => !m.drawingId || drawn(m.drawingId)) &&
    (edit.links ?? []).every((l) =>
      l.drawingId
        ? drawn(l.drawingId)
        : (!!l.id && !!links[l.id]) || drawn("arrow"),
    )
  );
};
/** An edit as the workspace reads it from what was written: every shape problem at once, in
 * terms of the record it is in. */
export function readEdit(input: unknown): WorkEdit {
  const read = workEditSchema.safeParse(input);
  if (read.success) return read.data;
  const named = (path: PropertyKey[]) => {
    const [part, place, ...rest] = path;
    const record = (input as Record<string, unknown>)?.[part as string];
    const id = Array.isArray(record) ? record[place as number]?.id : undefined;
    return [part, typeof id === "string" ? id : place, ...rest].join(".");
  };
  throw new EditRejected(
    read.error.issues.map((issue) => ({
      at: named(issue.path),
      problem:
        issue.code === "unrecognized_keys"
          ? `不认识的字段 ${issue.keys.join("、")}`
          : issue.code === "invalid_union"
            ? "写法不对：应该是模块 ID，或 {moduleId, at}，at 是 left、right、top、bottom 或 [x, y]"
            : issue.message,
    })),
  );
}
const records = ["scenes", "modules", "links", "drawings", "details"] as const;
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Two changes to one record as one, written or not. What the later says wins; objects it
 * changes keep what the earlier said about their other keys, and edits to text run in turn. */
function bothRecords(a: Record<string, unknown>, b: Record<string, unknown>) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b))
    out[key] =
      Array.isArray(a[key]) && Array.isArray(value) && /edits$/i.test(key)
        ? [...a[key], ...value]
        : isObject(a[key]) && isObject(value) && key !== "target"
          ? bothRecords(a[key], value)
          : value;
  return out;
}
/** Two edits as one, the later laid on the earlier, whether or not they read as edits yet: a
 * refused write and its correction, or a hand edit in two steps. A record of the same id
 * becomes one record, and what the later removes the earlier no longer adds. */
export function composed(
  earlier: unknown,
  later: unknown,
): Record<string, unknown> {
  const a = isObject(earlier) ? earlier : {},
    b = isObject(later) ? later : {};
  const out: Record<string, unknown> = { ...a, ...b };
  const removed = isObject(b.remove) ? b.remove : {};
  for (const section of records) {
    const gone = new Set(
      Array.isArray(removed[section]) ? (removed[section] as unknown[]) : [],
    );
    const list = [...(Array.isArray(a[section]) ? a[section] : [])].filter(
      (r) => !gone.has(r?.id),
    );
    const add = Array.isArray(b[section]) ? b[section] : [];
    // A link written without an id is known by its ends.
    const name = (r: any) =>
      typeof r?.id === "string"
        ? r.id
        : section === "links" && r
          ? "\n" + linkKey(r)
          : undefined;
    for (const record of add) {
      const called = name(record);
      const at =
        called === undefined ? -1 : list.findIndex((r) => name(r) === called);
      if (at < 0) list.push(record);
      else list[at] = bothRecords(list[at], record as Record<string, unknown>);
    }
    if (list.length) out[section] = list;
    else delete out[section];
  }
  // A correction's own changes to every part come after the ones it corrects.
  if (Array.isArray(a.each) && Array.isArray(b.each))
    out.each = [...a.each, ...b.each];
  if (isObject(a.style) && isObject(b.style))
    out.style = { ...a.style, ...b.style };
  if (Array.isArray(a.materials) && Array.isArray(b.materials))
    out.materials = [...new Set([...a.materials, ...b.materials])];
  if (isObject(a.remove) && isObject(b.remove)) {
    const union: Record<string, unknown> = { ...a.remove };
    for (const [k, v] of Object.entries(b.remove))
      union[k] = [
        ...new Set([
          ...(Array.isArray(a.remove[k]) ? a.remove[k] : []),
          ...(Array.isArray(v) ? v : []),
        ]),
      ];
    out.remove = union;
  }
  return out;
}
