import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  ArrowRightLeft,
  BringToFront,
  ChevronRight,
  Copy,
  CornerDownRight,
  Group,
  ImagePlus,
  Lock,
  MousePointerClick,
  SendToBack,
  Shapes,
  Sparkles,
  Trash2,
  Type,
  Ungroup,
  Unlock,
} from "lucide-react";
import type { Canvas, Pointed } from "../../../modules/canvas/index.ts";
import {
  addScene,
  moveParts,
  reattach,
  removeParts,
  rename,
  reverse,
  scaled,
  setDetail,
  setTarget,
  sides,
  sideOf,
  type Alignment,
  type Side,
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
import type { Material, PictureMaterial } from "@drawy/materials/schema";
import { DrawingPanel, ModuleRecord } from "./EditCode.tsx";
import {
  DataEditor,
  Fields,
  Section,
  type PickPicture,
} from "./EditControls.tsx";
import { keys } from "./EditMenu.tsx";
import { Details, Layers, Look, SceneSettings } from "./EditWork.tsx";
import type { Change, EditOps } from "./handEdits.ts";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";

export type { Change } from "./handEdits.ts";

/** Two edits of the same revision as one, so a change that makes a scene or a detail and
 * points a module at it is one step. */
function both(a: WorkEdit, b: WorkEdit): WorkEdit {
  return {
    ...a,
    ...b,
    scenes: [...(a.scenes ?? []), ...(b.scenes ?? [])],
    details: [...(a.details ?? []), ...(b.details ?? [])],
  };
}
const TAB = "drawy.edit.tab";

/** The editing panel beside the canvas, in two tabs. Properties shows what can be changed
 * about the selection (its name, place and size, values and data, where it leads, its
 * links and, for those who want it, its drawing's code and its record), or, with nothing
 * selected, what to add and the scene's and the work's own settings. Layers lists the
 * scene's modules in stacking order. */
export function EditPanel({
  work,
  sceneId,
  selected,
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
  canvas?: Canvas;
  /** Why the work cannot be edited right now, if it cannot. */
  busy?: string;
  change: Change;
  ops: EditOps;
  pick: (kind: "picture" | "drawing", chosen: (m: Material) => void) => void;
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
  if (busy || !scene) return <p className={cx("edit-note")}>{busy}</p>;
  const pickPicture: PickPicture = (chosen) =>
    pick("picture", (m) => chosen(m as PictureMaterial));
  const modules = selected.flatMap((id) => {
    const m = scene.modules.find((x) => x.id === id);
    return m ? [m] : [];
  });
  return (
    <div className={cx("edit")}>
      <span className={cx("field-choice", "edit-tabs")} role="tablist">
        <button role="tab" aria-pressed={tab === "properties"} onClick={() => choose("properties")}>
          {t.edit.tabs.properties}
        </button>
        <button role="tab" aria-pressed={tab === "layers"} onClick={() => choose("layers")}>
          {t.edit.tabs.layers}
          <small>{scene.modules.length}</small>
        </button>
      </span>
      {tab === "layers" ? (
        <Layers work={work} sceneId={sceneId} selected={selected} canvas={canvas} change={change} />
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
      ) : (
        <>
          <p className={cx("edit-note")}>
            <MousePointerClick size={15} />
            {t.edit.howTo}
          </p>
          <section>
            <h3>{t.edit.add}</h3>
            <div className={cx("edit-adds")}>
              <button className={cx("secondary")} onClick={() => ops.add("text")}>
                <Type size={16} />
                {t.edit.addText}
              </button>
              <button className={cx("secondary")} onClick={() => ops.add("picture")}>
                <ImagePlus size={16} />
                {t.edit.addPicture}
              </button>
              <button className={cx("secondary")} onClick={() => ops.add("drawing")}>
                <Shapes size={16} />
                {t.edit.addDrawing}
              </button>
            </div>
          </section>
          <Section id="scene" title={sceneId === work.rootSceneId ? t.edit.scene.rootHeading : t.edit.scene.heading}>
            <SceneSettings work={work} sceneId={sceneId} change={change} openScene={openScene} />
          </Section>
          <Section id="look" title={t.edit.look}>
            <Look work={work} change={change} />
          </Section>
          <Section id="details" title={t.edit.details.heading} open={false}>
            <Details work={work} change={change} />
          </Section>
          <Section id="keys" title={t.edit.shortcuts.heading} open={false}>
            <Shortcuts />
          </Section>
        </>
      )}
    </div>
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
  pick: (kind: "picture" | "drawing", chosen: (m: Material) => void) => void;
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
  return (
    <>
      <header className={cx("edit-head")}>
        {one ? (
          <input
            key={one.id + ":" + one.label}
            className={cx("edit-name")}
            aria-label={t.edit.name}
            placeholder={t.edit.untitled}
            defaultValue={one.label}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) =>
              e.target.value !== one.label &&
              void change((w) => rename(w, sceneId, one.id, e.target.value))
            }
          />
        ) : (
          <h3>{t.edit.many(modules.length)}</h3>
        )}
        <nav className={cx("edit-actions")}>
          <button data-tip={keys(t.edit.duplicate)} onClick={ops.duplicate}>
            <Copy size={15} />
            {t.edit.actions.duplicate}
          </button>
          {grouped && (modules.length === 1 || modules.every((m) => m.group === modules[0].group)) ? (
            <button data-tip={keys(t.edit.ungroupTip)} onClick={ops.ungroup}>
              <Ungroup size={15} />
              {t.edit.actions.ungroup}
            </button>
          ) : (
            <button data-tip={keys(t.edit.groupTip)} disabled={modules.length < 2} onClick={ops.group}>
              <Group size={15} />
              {t.edit.actions.group}
            </button>
          )}
          <button data-tip={keys(t.edit.front)} onClick={() => ops.stack("front")}>
            <BringToFront size={15} />
            {t.edit.actions.front}
          </button>
          <button data-tip={keys(t.edit.back)} onClick={() => ops.stack("back")}>
            <SendToBack size={15} />
            {t.edit.actions.back}
          </button>
          <button data-tip={t.edit.remove} data-tone="danger" onClick={ops.remove}>
            <Trash2 size={15} />
            {t.edit.actions.remove}
          </button>
        </nav>
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
        <Place key={modules.map((m) => m.id).join()} sceneId={sceneId} modules={modules} change={change} />
        <Arrange count={modules.length} ops={ops} />
      </Section>
      {one && (
        <Section id="content" title={t.edit.content}>
          <Fields
            key={one.id + ":" + work.revision}
            work={work}
            sceneId={sceneId}
            part={one}
            canvas={canvas}
            change={change}
            pickPicture={pickPicture}
          />
          <DataEditor
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
        <Section id="links" title={t.edit.links}>
          {links.map((l) => (
            <Connection
              key={l.id}
              work={work}
              sceneId={sceneId}
              link={l}
              from={one.id}
              change={change}
              pickPicture={pickPicture}
            />
          ))}
          <p className={cx("edit-hint")}>{t.edit.linkHint}</p>
        </Section>
      )}
      {one && (
        <Section id="advanced" title={t.edit.code.heading} open={false}>
          <p className={cx("edit-hint")}>{t.edit.code.hint}</p>
          <DrawingPanel work={work} sceneId={sceneId} module={one} change={change} pick={pick} />
          <div className={cx("field")}>
            <span className={cx("field-name")}>{t.edit.code.record}</span>
            <ModuleRecord work={work} sceneId={sceneId} module={one} change={change} />
          </div>
        </Section>
      )}
      <p className={cx("edit-note")}>{one ? t.edit.tipOne : t.edit.tipMany}</p>
      <button className={cx("edit-ask")} onClick={ask}>
        <Sparkles size={15} />
        {t.edit.ask}
      </button>
    </>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
/** Where the selection is and how large, in scene units, typed in. Several modules are
 * placed and sized as one, each keeping its share. */
function Place({
  sceneId,
  modules,
  change,
}: {
  sceneId: string;
  modules: Instance[];
  change: Change;
}) {
  const t = useT();
  const [locked, setLocked] = useState(false);
  const frame = union(modules.map((m) => m.bounds));
  const commit = (key: keyof Bounds, value: number) => {
    if (!Number.isFinite(value) || round(frame[key]) === round(value)) return;
    if ((key === "width" || key === "height") && value < 1) return;
    const next = { ...frame, [key]: value };
    if (locked && key === "width") next.height = (value * frame.height) / frame.width;
    if (locked && key === "height") next.width = (value * frame.width) / frame.height;
    const moves = modules.map((m) => ({
      id: m.id,
      bounds: modules.length === 1 ? next : scaled(m.bounds, frame, next),
    }));
    void change((w) => moveParts(w, sceneId, moves));
  };
  const box = (key: keyof Bounds, label: string) => (
    <label className={cx("place-field")}>
      <span>{label}</span>
      <input
        key={frame[key]}
        type="number"
        step="1"
        defaultValue={round(frame[key])}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
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
        {locked ? <Lock size={13} /> : <Unlock size={13} />}
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
    </div>
  );
}

const NEW_SCENE = "\u0000scene",
  NEW_DETAIL = "\u0000detail";
const keyOf = (t: Target | null) => (t ? `${t.kind}:${t.id}` : "");
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
  const name = modules[0].label || t.edit.untitled;
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

/** A link of the selected module: where it goes, which side of each module it leaves and
 * meets, its direction, what can be changed about it, and a way to take it out. */
function Connection({
  work,
  sceneId,
  link,
  from,
  change,
  pickPicture,
}: {
  work: Work;
  sceneId: string;
  link: Link;
  from: string;
  change: Change;
  pickPicture: PickPicture;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const scene = work.scenes[sceneId];
  const other = link.from.moduleId === from ? link.to : link.from;
  const name =
    scene.modules.find((m) => m.id === other.moduleId)?.label || other.moduleId;
  const sideAt = (end: "from" | "to"): Side | "" => {
    const m = scene.modules.find((x) => x.id === link[end].moduleId);
    const a = m?.anchors[link[end].anchor];
    return (a && sideOf(a)) || "";
  };
  const end = (which: "from" | "to") => (
    <label className={cx("field")} data-inline>
      <span className={cx("field-name")}>
        {which === "from" ? t.edit.linkEnds.from : t.edit.linkEnds.to}
      </span>
      <span className={cx("field-choice")} role="group">
        {sides.map((s) => (
          <button
            key={s}
            aria-pressed={sideAt(which) === s}
            onClick={() => void change((w) => reattach(w, sceneId, link.id, which, s))}
          >
            {t.edit.linkEnds.sides[s]}
          </button>
        ))}
      </span>
    </label>
  );
  return (
    <div className={cx("connection")} data-open={open || undefined}>
      <div className={cx("connection-head")}>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight size={14} />
          <span>
            {link.from.moduleId === from ? t.edit.to(name) : t.edit.from(name)}
          </span>
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
      </div>
      {open && (
        <div className={cx("fields")} data-indent>
          {end("from")}
          {end("to")}
          <Fields
            key={work.revision}
            work={work}
            sceneId={sceneId}
            part={link}
            change={change}
            pickPicture={pickPicture}
          />
          <DataEditor
            work={work}
            sceneId={sceneId}
            part={link}
            change={change}
            pickPicture={pickPicture}
          />
        </div>
      )}
    </div>
  );
}

/** The keyboard while editing. */
function Shortcuts() {
  const t = useT();
  return (
    <dl className={cx("shortcuts")}>
      {t.edit.shortcuts.list.map(([key, what]) => (
        <div key={key}>
          <dt>
            <kbd>{keys(key)}</kbd>
          </dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
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
