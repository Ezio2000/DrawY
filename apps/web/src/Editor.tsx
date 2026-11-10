import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowRight,
  ArrowRightLeft,
  BringToFront,
  ChevronRight,
  Copy,
  CornerDownRight,
  Group,
  Lock,
  SendToBack,
  MessageSquareQuote,
  Spline,
  StretchHorizontal,
  StretchVertical,
  Trash2,
  Ungroup,
  Unlock,
} from "lucide-react";
import type { Canvas, Pointed } from "../../../modules/canvas/index.ts";
import {
  addScene,
  composed,
  labelOf,
  shownName,
  moveParts,
  reattach,
  removeParts,
  rename,
  restyle,
  reverse,
  scaled,
  setDetail,
  setTarget,
  sharedFields,
  sides,
  sideOf,
  useDrawing,
  type Alignment,
  type SharedField,
} from "../../../modules/editing/index.ts";
import { union } from "../../../modules/contracts/geometry.ts";
import type {
  Bounds,
  Instance,
  Link,
  Target,
  Work,
  WorkEdit,
} from "../../../modules/contracts/index.ts";
import type {
  DrawingMaterial,
  Material,
  PictureMaterial,
} from "@drawy/materials/schema";
import { Dialog, Switch, useLocale } from "@drawy/ui";
import { DrawingPanel, ModuleRecord } from "./EditCode.tsx";
import {
  Amount,
  Colors,
  DataEditor,
  Fields,
  nameOf,
  optionOf,
  Section,
  type PickPicture,
} from "./EditControls.tsx";
import { keys } from "./EditMenu.tsx";
import { Details, Layers, Look, SceneScript, SceneSettings } from "./EditWork.tsx";
import type { Change } from "./session/work.ts";
import type { EditOps } from "./desktop/editing.ts";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";


/** Two edits of the same revision as one, so a change that makes a scene or a detail and
 * points a module at it is one step. */
const both = (a: WorkEdit, b: WorkEdit) => composed(a, b) as WorkEdit;
const TAB = "drawy.edit.tab";
type Pick = (kind: "picture" | "drawing", chosen: (m: Material) => void) => void;

/** The editing panel beside the canvas, in two tabs. Properties shows what can be changed
 * about the selection: for modules their name, place and size, values and data, where they
 * lead, their links and, for those who want it, their drawing's code and record; for a
 * link its ends, values and drawing; with nothing selected, what to add and the scene's
 * and the work's own settings. Layers lists the scene's modules in stacking order, and
 * its links. */
export function EditPanel({
  work,
  sceneId,
  selected,
  link,
  canvas,
  busy,
  change,
  ops,
  pick,
  ask,
  openScene,
}: {
  work: Work;
  sceneId: string;
  selected: string[];
  /** The link selected, when no module is. */
  link: string | null;
  canvas?: Canvas;
  /** Why the work cannot be edited right now, if it cannot. */
  busy?: string;
  change: Change;
  ops: EditOps;
  pick: Pick;
  ask: () => void;
  openScene: (id: string) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"properties" | "layers">(() => {
    try {
      return localStorage.getItem(TAB) === "layers" ? "layers" : "properties";
    } catch {
      return "properties";
    }
  });
  const choose = (next: typeof tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB, next);
    } catch {}
  };
  const scene = work.scenes[sceneId];
  const top = useRef<HTMLDivElement>(null);
  // Something else selected is read from the top.
  const showing = tab + ":" + selected.join() + ":" + (link ?? "");
  useLayoutEffect(() => {
    top.current?.parentElement?.scrollTo({ top: 0 });
  }, [showing]);
  if (busy || !scene) return <p className={cx("edit-note")}>{busy}</p>;
  const pickPicture: PickPicture = (chosen) =>
    pick("picture", (m) => chosen(m as PictureMaterial));
  const modules = selected.flatMap((id) => {
    const m = scene.modules.find((x) => x.id === id);
    return m ? [m] : [];
  });
  const chosenLink = !modules.length && link ? scene.links.find((l) => l.id === link) : undefined;
  return (
    <div ref={top} className={cx("edit")}>
      <span className={cx("field-choice", "edit-tabs")} role="tablist">
        <button role="tab" aria-pressed={tab === "properties"} onClick={() => choose("properties")}>
          {t.edit.tabs.properties}
        </button>
        <button role="tab" aria-pressed={tab === "layers"} onClick={() => choose("layers")}>
          {t.edit.tabs.layers}
          <small>{scene.modules.length + scene.links.length}</small>
        </button>
      </span>
      {tab === "layers" ? (
        <Layers
          work={work}
          sceneId={sceneId}
          selected={selected}
          link={link}
          canvas={canvas}
          change={change}
        />
      ) : modules.length ? (
        <Selected
          work={work}
          sceneId={sceneId}
          modules={modules}
          canvas={canvas}
          change={change}
          ops={ops}
          pick={pick}
          pickPicture={pickPicture}
          ask={ask}
          openScene={openScene}
        />
      ) : chosenLink ? (
        <LinkPanel
          key={chosenLink.id}
          work={work}
          sceneId={sceneId}
          link={chosenLink}
          canvas={canvas}
          change={change}
          ops={ops}
          pick={pick}
          pickPicture={pickPicture}
          ask={ask}
        />
      ) : (
        <>
          <Section id="scene" title={sceneId === work.rootSceneId ? t.edit.scene.rootHeading : t.edit.scene.heading}>
            <SceneSettings work={work} sceneId={sceneId} change={change} openScene={openScene} />
          </Section>
          <Section id="look" title={t.edit.look} open={false}>
            <Look work={work} change={change} />
          </Section>
          <Section id="script" title={t.edit.scene.script} open={false}>
            <SceneScript work={work} sceneId={sceneId} change={change} />
          </Section>
          <Section id="details" title={t.edit.details.heading} open={false}>
            <Details work={work} change={change} />
          </Section>
        </>
      )}
    </div>
  );
}

/** A row of small actions with their names in tooltips. */
function Actions({ children }: { children: ReactNode }) {
  return <nav className={cx("edit-actions")}>{children}</nav>;
}
function Act({
  label,
  tip,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tip?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      data-tip={tip ?? label}
      data-tone={danger ? "danger" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** What can be changed about the selected modules. */
function Selected({
  work,
  sceneId,
  modules,
  canvas,
  change,
  ops,
  pick,
  pickPicture,
  ask,
  openScene,
}: {
  work: Work;
  sceneId: string;
  modules: Instance[];
  canvas?: Canvas;
  change: Change;
  ops: EditOps;
  pick: Pick;
  pickPicture: PickPicture;
  ask: () => void;
  openScene: (id: string) => void;
}) {
  const t = useT();
  const scene = work.scenes[sceneId];
  const one = modules.length === 1 ? modules[0] : undefined;
  const grouped = modules.some((m) => m.group);
  const links = one
    ? scene.links.filter((l) => l.from.moduleId === one.id || l.to.moduleId === one.id)
    : [];
  const drawing = one && (work.drawings[one.drawingId]?.name ?? work.materials[one.drawingId]?.name);
  return (
    <>
      <header className={cx("edit-head")}>
        <div className={cx("edit-title")}>
          {one ? (
            <input
              key={one.id + ":" + shownName(work, one)}
              className={cx("edit-name")}
              aria-label={t.edit.name}
              placeholder={t.edit.untitled}
              defaultValue={shownName(work, one)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = shownName(work, one);
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) =>
                e.target.value !== shownName(work, one) &&
                void change((w) => rename(w, sceneId, one.id, e.target.value))
              }
            />
          ) : (
            <h3>{t.edit.many(modules.length)}</h3>
          )}
          {drawing && <small>{drawing}</small>}
        </div>
        <Actions>
          <Act label={t.edit.actions.duplicate} tip={keys(t.edit.duplicate)} onClick={ops.duplicate}>
            <Copy size={16} />
          </Act>
          {grouped && (modules.length === 1 || modules.every((m) => m.group === modules[0].group)) ? (
            <Act label={t.edit.actions.ungroup} tip={keys(t.edit.ungroupTip)} onClick={ops.ungroup}>
              <Ungroup size={16} />
            </Act>
          ) : (
            <Act
              label={t.edit.actions.group}
              tip={keys(t.edit.groupTip)}
              disabled={modules.length < 2}
              onClick={ops.group}
            >
              <Group size={16} />
            </Act>
          )}
          <Act label={t.edit.actions.front} tip={keys(t.edit.front)} onClick={() => ops.stack("front")}>
            <BringToFront size={16} />
          </Act>
          <Act label={t.edit.actions.back} tip={keys(t.edit.back)} onClick={() => ops.stack("back")}>
            <SendToBack size={16} />
          </Act>
          <i />
          <Act label={t.edit.actions.ask} onClick={ask}>
            <MessageSquareQuote size={16} />
          </Act>
          <Act label={t.edit.actions.remove} tip={t.edit.remove} danger onClick={ops.remove}>
            <Trash2 size={16} />
          </Act>
        </Actions>
        {one?.group && (
          <button
            className={cx("edit-link")}
            onClick={() =>
              canvas?.select(scene.modules.filter((m) => m.group === one.group).map((m) => m.id))
            }
          >
            <Group size={13} />
            {t.edit.selectGroup}
          </button>
        )}
      </header>
      <Section id="place" title={t.edit.place.heading}>
        <Place sceneId={sceneId} modules={modules} canvas={canvas} change={change} />
        <Arrange count={modules.length} ops={ops} />
      </Section>
      {!one && (
        <Shared work={work} sceneId={sceneId} modules={modules} canvas={canvas} change={change} />
      )}
      {one && (
        <Section id="content" title={t.edit.content}>
          <Fields
            key={one.id}
            work={work}
            sceneId={sceneId}
            part={one}
            canvas={canvas}
            change={change}
            pickPicture={pickPicture}
          />
          <DataEditor
            key={"data:" + one.id}
            work={work}
            sceneId={sceneId}
            part={one}
            canvas={canvas}
            change={change}
            pickPicture={pickPicture}
          />
        </Section>
      )}
      <Section id="target" title={t.edit.target.heading}>
        <Leads work={work} sceneId={sceneId} modules={modules} change={change} openScene={openScene} />
      </Section>
      {one && (
        <Section id="links" title={t.edit.links} count={links.length}>
          {!!links.length && (
            <ul className={cx("link-rows")}>
              {links.map((l) => (
                <Connection key={l.id} work={work} sceneId={sceneId} link={l} from={one.id} canvas={canvas} change={change} />
              ))}
            </ul>
          )}
        </Section>
      )}
      {one && (
        <Section id="advanced" title={t.edit.code.heading} open={false}>
          <DrawingPanel key={one.id} work={work} sceneId={sceneId} module={one} change={change} pick={pick} />
          <div className={cx("field")}>
            <span className={cx("field-name")}>{t.edit.code.record}</span>
            <ModuleRecord key={one.id} work={work} sceneId={sceneId} module={one} change={change} />
          </div>
        </Section>
      )}
      <button className={cx("edit-ask")} onClick={ask}>
        <MessageSquareQuote size={15} />
        {t.edit.ask}
      </button>
    </>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
/** Where the selection is and how large, in scene units: typed in, or dragged sideways on
 * a field's letter to scrub it (Shift ten times as fast). Several modules are placed and
 * sized as one, each keeping its share. */
function Place({
  sceneId,
  modules,
  canvas,
  change,
}: {
  sceneId: string;
  modules: Instance[];
  canvas?: Canvas;
  change: Change;
}) {
  const t = useT();
  const [locked, setLocked] = useState(false);
  const frame = union(modules.map((m) => m.bounds));
  const movesFor = (key: keyof Bounds, value: number) => {
    const next = { ...frame, [key]: value };
    if (locked && key === "width") next.height = (value * frame.height) / frame.width;
    if (locked && key === "height") next.width = (value * frame.width) / frame.height;
    return modules.map((m) => ({
      id: m.id,
      bounds: modules.length === 1 ? next : scaled(m.bounds, frame, next),
    }));
  };
  const valid = (key: keyof Bounds, value: number) =>
    Number.isFinite(value) &&
    round(frame[key]) !== round(value) &&
    !((key === "width" || key === "height") && value < 1);
  const commit = (key: keyof Bounds, value: number) => {
    if (!valid(key, value)) return;
    const moves = movesFor(key, value);
    void change((w) => moveParts(w, sceneId, moves));
  };
  const box = (key: keyof Bounds, label: string) => (
    <label className={cx("place-field")}>
      <span
        data-tip={t.edit.place.scrub}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const el = e.currentTarget,
            input = el.nextElementSibling as HTMLInputElement,
            start = e.clientX,
            from = frame[key];
          el.setPointerCapture(e.pointerId);
          let value = from;
          const move = (m: PointerEvent) => {
            const step = (m.shiftKey ? 10 : 1) / Math.max(0.25, canvas?.scale ?? 1);
            value = Math.round(from + (m.clientX - start) * step);
            if ((key === "width" || key === "height") && value < 1) value = 1;
            input.value = String(value);
            canvas?.reshape(movesFor(key, value));
          };
          const up = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
            if (valid(key, value)) commit(key, value);
            else canvas?.reshape(modules.map((m) => ({ id: m.id, bounds: m.bounds })));
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
          el.addEventListener("pointercancel", up);
        }}
      >
        {label}
      </span>
      <input
        key={frame[key]}
        type="number"
        step="1"
        defaultValue={round(frame[key])}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = String(round(frame[key]));
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => commit(key, Number(e.target.value))}
      />
    </label>
  );
  return (
    <div className={cx("place")}>
      {box("x", "X")}
      {box("y", "Y")}
      {box("width", t.edit.place.width)}
      {box("height", t.edit.place.height)}
      <button
        className={cx("place-lock")}
        aria-pressed={locked}
        aria-label={t.edit.place.lock}
        data-tip={t.edit.place.lock}
        onClick={() => setLocked(!locked)}
      >
        {locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
    </div>
  );
}
/** Lining the selection up, and spacing three or more evenly. One module lines up with
 * the rest of the scene. */
function Arrange({ count, ops }: { count: number; ops: EditOps }) {
  const t = useT();
  const a = t.edit.align;
  const items: [Alignment, typeof AlignStartVertical, string, string][] = [
    ["left", AlignStartVertical, a.left, "Alt+A"],
    ["center", AlignCenterVertical, a.center, "Alt+H"],
    ["right", AlignEndVertical, a.right, "Alt+D"],
    ["top", AlignStartHorizontal, a.top, "Alt+W"],
    ["middle", AlignCenterHorizontal, a.middle, "Alt+V"],
    ["bottom", AlignEndHorizontal, a.bottom, "Alt+S"],
  ];
  return (
    <div className={cx("arrange")} role="group" aria-label={a.label}>
      {items.map(([to, Icon, label, key]) => (
        <button key={to} aria-label={label} data-tip={`${label} · ${keys(key)}`} onClick={() => ops.align(to)}>
          <Icon size={15} />
        </button>
      ))}
      <i />
      <button
        aria-label={a.spreadX}
        data-tip={`${a.spreadX} · ${keys("Alt+Shift+H")}`}
        disabled={count < 3}
        onClick={() => ops.distribute("x")}
      >
        <AlignHorizontalDistributeCenter size={15} />
      </button>
      <button
        aria-label={a.spreadY}
        data-tip={`${a.spreadY} · ${keys("Alt+Shift+V")}`}
        disabled={count < 3}
        onClick={() => ops.distribute("y")}
      >
        <AlignVerticalDistributeCenter size={15} />
      </button>
      <i />
      <button
        aria-label={t.edit.match.width}
        data-tip={t.edit.match.width}
        disabled={count < 2}
        onClick={() => ops.matchSize("width")}
      >
        <StretchHorizontal size={15} />
      </button>
      <button
        aria-label={t.edit.match.height}
        data-tip={t.edit.match.height}
        disabled={count < 2}
        onClick={() => ops.matchSize("height")}
      >
        <StretchVertical size={15} />
      </button>
    </div>
  );
}

const NEW_SCENE = "\u0000scene",
  NEW_DETAIL = "\u0000detail";
const keyOf = (t?: Target) => (t ? `${t.kind}:${t.id}` : "");
/** Where a click on the selected modules leads: nowhere, into a scene below or another
 * scene, or to a detail; a new scene or detail can be made for it at once. */
function Leads({
  work,
  sceneId,
  modules,
  change,
  openScene,
}: {
  work: Work;
  sceneId: string;
  modules: Instance[];
  change: Change;
  openScene: (id: string) => void;
}) {
  const t = useT();
  const ids = modules.map((m) => m.id);
  const keysNow = new Set(modules.map((m) => keyOf(m.target)));
  const current = keysNow.size === 1 ? [...keysNow][0] : "\u0000mixed";
  const target = modules[0].target;
  const name = shownName(work, modules[0]);
  const set = (value: string) => {
    if (value === NEW_SCENE)
      return void change((w) => {
        const s = addScene(w, sceneId, name);
        return both(s.edit, setTarget(w, sceneId, ids, { kind: "scene", id: s.id }));
      });
    if (value === NEW_DETAIL)
      return void change((w) => {
        const d = setDetail(w, { title: name, html: `<h2>${name.replace(/[&<>]/g, "")}</h2>\n<p></p>` });
        return both(d.edit, setTarget(w, sceneId, ids, { kind: "detail", id: d.id }));
      });
    const [kind, ...rest] = value.split(":");
    void change((w) =>
      setTarget(w, sceneId, ids, value ? { kind: kind as Target["kind"], id: rest.join(":") } : null),
    );
  };
  return (
    <div className={cx("fields")}>
      <select className={cx("edit-select")} value={current} onChange={(e) => set(e.target.value)}>
        {current === "\u0000mixed" && <option value="\u0000mixed">{t.edit.target.mixed}</option>}
        <option value="">{t.edit.target.none}</option>
        <optgroup label={t.edit.target.scenes}>
          {Object.values(work.scenes)
            .filter((s) => s.id !== sceneId)
            .map((s) => (
              <option key={s.id} value={`scene:${s.id}`}>
                {s.id === work.rootSceneId ? work.title : s.title}
              </option>
            ))}
          <option value={NEW_SCENE}>{t.edit.target.newScene}</option>
        </optgroup>
        <optgroup label={t.edit.target.details}>
          {Object.values(work.details).map((d) => (
            <option key={d.id} value={`detail:${d.id}`}>
              {d.title}
            </option>
          ))}
          <option value={NEW_DETAIL}>{t.edit.target.newDetail}</option>
        </optgroup>
      </select>
      {keysNow.size === 1 && target?.kind === "scene" && work.scenes[target.id] && (
        <button className={cx("edit-link")} onClick={() => openScene(target.id)}>
          <CornerDownRight size={13} />
          {t.edit.target.open(work.scenes[target.id].title)}
        </button>
      )}
    </div>
  );
}

/** A module's name as the editor shows it. */
const nameIn = (work: Work, sceneId: string, id: string) => {
  const m = work.scenes[sceneId]?.modules.find((x) => x.id === id);
  return m ? shownName(work, m) : id;
};
/** A link of the selected module, as a row: a press selects the link to change it; it can
 * be turned round or taken out where it is. */
function Connection({
  work,
  sceneId,
  link,
  from,
  canvas,
  change,
}: {
  work: Work;
  sceneId: string;
  link: Link;
  from: string;
  canvas?: Canvas;
  change: Change;
}) {
  const t = useT();
  const out = link.from.moduleId === from;
  const other = nameIn(work, sceneId, out ? link.to.moduleId : link.from.moduleId);
  const words = ["label", "text", "title"]
    .map((k) => link.data[k])
    .find((v): v is string => typeof v === "string" && !!v);
  return (
    <li className={cx("link-row")}>
      <button className={cx("link-row-main")} onClick={() => canvas?.selectLink(link.id)} data-tip={t.edit.linkPanel.select}>
        <Spline size={14} />
        <span>{out ? t.edit.to(other) : t.edit.from(other)}</span>
        {words && <small>{words}</small>}
        <ChevronRight size={14} />
      </button>
      <button
        aria-label={t.edit.linkEnds.reverse}
        data-tip={t.edit.linkEnds.reverse}
        onClick={() => void change((w) => reverse(w, sceneId, link.id))}
      >
        <ArrowRightLeft size={14} />
      </button>
      <button
        aria-label={t.edit.removeLink}
        data-tip={t.edit.removeLink}
        data-tone="danger"
        onClick={() => void change((w) => removeParts(w, sceneId, [link.id]))}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

const FROM_LIBRARY = "\u0000library";
/** What can be changed about the selected link: the modules and sides its ends meet, its
 * direction, its values and data, and the drawing it is drawn with. */
function LinkPanel({
  work,
  sceneId,
  link,
  canvas,
  change,
  ops,
  pick,
  pickPicture,
  ask,
}: {
  work: Work;
  sceneId: string;
  link: Link;
  canvas?: Canvas;
  change: Change;
  ops: EditOps;
  pick: Pick;
  pickPicture: PickPicture;
  ask: () => void;
}) {
  const t = useT(),
    locale = useLocale(),
    l = t.edit.linkPanel;
  const scene = work.scenes[sceneId];
  const name = (id: string) => nameIn(work, sceneId, id);
  const modules = scene.modules;
  const end = (which: "from" | "to") => {
    const other = link[which === "from" ? "to" : "from"].moduleId;
    const at = link[which].at;
    const side = Array.isArray(at) ? sideOf({ x: at[0], y: at[1] }) : at;
    // A new module is met on the side facing the other end, following it as things move.
    const moveTo = (moduleId: string, s?: (typeof sides)[number]) =>
      void change((w) => reattach(w, sceneId, link.id, which, s, moduleId));
    return (
      <div className={cx("link-end")}>
        <span className={cx("field-name")}>{which === "from" ? t.edit.linkEnds.from : t.edit.linkEnds.to}</span>
        <select
          className={cx("edit-select")}
          value={link[which].moduleId}
          onChange={(e) => moveTo(e.target.value)}
        >
          {modules
            .filter((x) => x.id !== other)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {shownName(work, x)}
              </option>
            ))}
        </select>
        <span className={cx("field-choice")} role="group" aria-label={l.side}>
          <button aria-pressed={at === undefined} onClick={() => at !== undefined && moveTo(link[which].moduleId)}>
            {t.edit.linkEnds.auto}
          </button>
          {sides.map((s) => (
            <button key={s} aria-pressed={side === s} onClick={() => side !== s && moveTo(link[which].moduleId, s)}>
              {t.edit.linkEnds.sides[s]}
            </button>
          ))}
        </span>
      </div>
    );
  };
  // The drawings links in this work are drawn with, and the library's arrow.
  const drawings = new Map<string, string>();
  for (const s of Object.values(work.scenes))
    for (const x of s.links)
      drawings.set(x.drawingId, work.drawings[x.drawingId]?.name ?? work.materials[x.drawingId]?.name ?? x.drawingId);
  if (!drawings.has("arrow") && !work.drawings.arrow)
    drawings.set("arrow", work.materials.arrow?.name ?? l.arrow);
  return (
    <>
      <header className={cx("edit-head")}>
        <div className={cx("edit-title")}>
          <span className={cx("edit-kind")}>
            <Spline size={13} />
            {l.heading}
          </span>
          <h3>
            {name(link.from.moduleId)}
            <ArrowRight size={15} />
            {name(link.to.moduleId)}
          </h3>
        </div>
        <Actions>
          <Act label={t.edit.linkEnds.reverse} tip={`${t.edit.linkEnds.reverse} · R`} onClick={() => ops.reverse(link.id)}>
            <ArrowRightLeft size={16} />
          </Act>
          <Act label={l.selectEnds} onClick={() => canvas?.select([link.from.moduleId, link.to.moduleId])}>
            <Group size={16} />
          </Act>
          <i />
          <Act label={t.edit.actions.ask} onClick={ask}>
            <MessageSquareQuote size={16} />
          </Act>
          <Act label={t.edit.removeLink} tip={t.edit.remove} danger onClick={ops.remove}>
            <Trash2 size={16} />
          </Act>
        </Actions>
      </header>
      <Section id="link-ends" title={l.ends}>
        {end("from")}
        {end("to")}
      </Section>
      <Section id="link-content" title={t.edit.content}>
        <Fields key={link.id} work={work} sceneId={sceneId} part={link} canvas={canvas} change={change} pickPicture={pickPicture} />
        <DataEditor key={"data:" + link.id} work={work} sceneId={sceneId} part={link} canvas={canvas} change={change} pickPicture={pickPicture} />
      </Section>
      <Section id="link-drawing" title={l.drawing} open={false}>
        <select
          className={cx("edit-select")}
          value={link.drawingId}
          onChange={(e) => {
            const id = e.target.value;
            if (id === FROM_LIBRARY)
              return pick("drawing", (m) => {
                if ((m as DrawingMaterial).use !== "link") throw Error(l.notLink(m.name[locale]));
                void change((w) => useDrawing(w, sceneId, [link.id], m.id));
              });
            void change((w) => useDrawing(w, sceneId, [link.id], id));
          }}
        >
          {[...drawings].map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
          <option value={FROM_LIBRARY}>{t.edit.code.fromLibrary}</option>
        </select>
      </Section>
    </>
  );
}

/** How several selected modules look, as the values they can all be given at once: a
 * choice, a colour, a number or a switch every one of them has. Each change goes to them
 * all; a value they differ in shows as none chosen until one is. */
function Shared({
  work,
  sceneId,
  modules,
  canvas,
  change,
}: {
  work: Work;
  sceneId: string;
  modules: Instance[];
  canvas?: Canvas;
  change: Change;
}) {
  const t = useT();
  const fields = sharedFields(work, modules);
  if (!fields.length) return null;
  const ids = modules.map((m) => m.id);
  const keep = (f: SharedField, value: unknown) =>
    void change((w) => restyle(w, sceneId, ids, { [f.key]: value }));
  const show = (f: SharedField, value: unknown) => {
    for (const m of modules) canvas?.preview(m.id, { ...m.data, [f.key]: value });
  };
  return (
    <Section id="shared" title={t.edit.shared}>
      <div className={cx("fields")} key={ids.join()}>
        {fields.map((f) => {
          const head = <span className={cx("field-name")}>{nameOf(t, f)}</span>;
          const v = f.mixed ? undefined : f.value;
          switch (f.type) {
            case "choice":
              return f.options!.length > 5 ? (
                <label key={f.key} className={cx("field")} data-inline>
                  {head}
                  <select
                    className={cx("edit-select")}
                    data-short
                    value={String(v ?? "")}
                    onChange={(e) => keep(f, e.target.value)}
                  >
                    {!f.options!.includes(String(v)) && <option value="">{t.edit.target.mixed}</option>}
                    {f.options!.map((o) => (
                      <option key={o} value={o}>
                        {optionOf(t, o)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div key={f.key} className={cx("field")}>
                  {head}
                  <span className={cx("field-choice")} role="group">
                    {f.options!.map((o) => (
                      <button key={o} aria-pressed={v === o} onClick={() => v !== o && keep(f, o)}>
                        {optionOf(t, o)}
                      </button>
                    ))}
                  </span>
                </div>
              );
            case "color":
              return (
                <div key={f.key} className={cx("field")}>
                  {head}
                  <Colors
                    work={work}
                    value={typeof v === "string" ? v : undefined}
                    auto={f.optional}
                    onChange={(c) => show(f, c)}
                    onDone={(c) => keep(f, c)}
                  />
                </div>
              );
            case "number":
              return (
                <label
                  key={f.key}
                  className={cx("field")}
                  data-inline={f.min === undefined || f.max === undefined || undefined}
                >
                  {head}
                  <Amount
                    field={f}
                    value={typeof v === "number" ? v : undefined}
                    onChange={(n) => show(f, n)}
                    onDone={(n) => keep(f, n)}
                  />
                </label>
              );
            case "boolean":
              return (
                <div key={f.key} className={cx("field")} data-inline>
                  {head}
                  <Switch checked={!!v} onChange={(on) => keep(f, on)} />
                </div>
              );
            default:
              return null;
          }
        })}
      </div>
    </Section>
  );
}

/** The gestures and the keyboard while editing, on a sheet of their own. */
export function ShortcutSheet({ close }: { close: () => void }) {
  const t = useT(),
    s = t.edit.shortcuts;
  const groups = ["tools", "selection", "arrange", "view"] as const;
  return (
    <Dialog title={s.heading} wide onClose={close}>
      <div className={cx("keys-sheet")}>
        <div className={cx("keys-columns")}>
          {groups.map((g) => (
            <section key={g}>
              <h4>{s.groups[g]}</h4>
              <dl>
                {s.list[g].map(([key, what]) => (
                  <div key={key}>
                    <dt>{what}</dt>
                    <dd>
                      {keys(key)
                        .split(" / ")
                        .map((k, i) => (
                          <kbd key={i}>{k}</kbd>
                        ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <ul className={cx("gestures")}>
          {s.gestures.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

/** Words being changed where they are drawn: a field laid over them at their size. Enter
 * or leaving keeps the change, Escape takes it back. */
export function Retype({
  pointed,
  stage,
  done,
}: {
  pointed: Extract<Pointed, { kind: "text" }>;
  stage: HTMLElement;
  done: (text: string | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(pointed.text);
  const finished = useRef(false);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    done(value);
  };
  useEffect(() => {
    ref.current!.focus();
    ref.current!.select();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);
  // The field stays over the words as the view moves under it.
  useLayoutEffect(() => {
    let frame = 0;
    const follow = () => {
      const el = ref.current!,
        area = stage.getBoundingClientRect(),
        { rect: r, size: s } = pointed.place(),
        size = Math.min(48, Math.max(13, s));
      Object.assign(el.style, {
        left: r.left - area.left - 6 + "px",
        top: r.top - area.top + r.height / 2 - size * 0.75 - 4 + "px",
        minWidth: Math.max(120, r.width + 24) + "px",
        fontSize: size + "px",
      });
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [pointed, stage]);
  return (
    <textarea
      ref={ref}
      className={cx("retype")}
      rows={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(null);
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(text);
        }
      }}
      onBlur={() => finish(text)}
    />
  );
}
