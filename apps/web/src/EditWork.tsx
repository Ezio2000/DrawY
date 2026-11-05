import { useEffect, useState, type CSSProperties } from "react";
import {
  ChevronRight,
  CornerDownRight,
  FileText,
  Group as GroupIcon,
  Plus,
  Spline,
  Trash2,
} from "lucide-react";
import type { Canvas } from "../../../modules/canvas/index.ts";
import {
  addScene,
  removeDetail,
  removeScene,
  rename,
  renameScene,
  restack,
  setDetail,
  setInteraction,
  setStyle,
  setStyles,
  labelOf,
  shownName,
  syntaxError,
} from "../../../modules/editing/index.ts";
import type { Work } from "../../../modules/contracts/index.ts";
import type { StyleMaterial } from "@drawy/materials/schema";
import { useLocale } from "@drawy/ui";
import { styleList } from "./Composer.tsx";
import { Code } from "./EditCode.tsx";
import { hex, Picker } from "./EditControls.tsx";
import type { Change } from "./handEdits.ts";
import { cx } from "./cx.ts";
import { useT } from "./i18n.tsx";

/* The work around the parts: its shared look, the scene and the scenes below it, the
 * details a click opens and the list of layers. */

/** Families of type a work can be set in, by what they look like. */
const faces = {
  sans: '"PingFang SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",system-ui,sans-serif',
  serif: '"Songti SC","Noto Serif CJK SC","Source Han Serif SC",serif',
  kai: '"Kaiti SC","STKaiti","AR PL UKai CN","KaiTi",serif',
} as const;
const faceOf = (font = "") =>
  /kai/i.test(font)
    ? "kai"
    : /song|serif/i.test(font) && !/sans/i.test(font)
      ? "serif"
      : "sans";
const isColour = (v: string) =>
  /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\))$/i.test(v.trim());
/** The work's own look, which every part takes unless it sets its own: each of its style
 * tokens (colours, type, line weight and any others its drawings read), and the palette
 * of a library style to take at once. */
export function Look({ work, change }: { work: Work; change: Change }) {
  const t = useT(),
    locale = useLocale();
  const [styles, setStyles_] = useState<StyleMaterial[]>([]);
  useEffect(() => void styleList().then(setStyles_, () => {}), []);
  const names = t.edit.tokens as Record<string, string>;
  const order = ["ink", "accent", "accent2", "muted", "paper", "stroke", "font"];
  const tokens = Object.keys(work.style).sort(
    (a, b) =>
      (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) ||
      a.localeCompare(b),
  );
  const face = faceOf(work.style.font);
  return (
    <div className={cx("fields")}>
      {tokens.map((k) => {
        const v = work.style[k];
        if (k === "font")
          return (
            <div key={k} className={cx("field")}>
              <span className={cx("field-name")}>{t.edit.font}</span>
              <span className={cx("field-choice")} role="group">
                {(Object.keys(faces) as (keyof typeof faces)[]).map((f) => (
                  <button
                    key={f}
                    aria-pressed={face === f}
                    style={{ fontFamily: faces[f] }}
                    onClick={() =>
                      face !== f && void change((w) => setStyle(w, "font", faces[f]))
                    }
                  >
                    {t.edit.faces[f]}
                  </button>
                ))}
              </span>
            </div>
          );
        if (isColour(v))
          return (
            <Token
              key={k + ":" + v}
              name={names[k] ?? k}
              value={v}
              set={(c) => c !== hex(v) && void change((w) => setStyle(w, k, c))}
            />
          );
        return (
          <label key={k + ":" + v} className={cx("field")} data-inline>
            <span className={cx("field-name")}>{names[k] ?? k}</span>
            <input
              className={cx("edit-input")}
              data-short
              defaultValue={v}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={(e) =>
                e.target.value !== v &&
                e.target.value.trim() &&
                void change((w) => setStyle(w, k, e.target.value.trim()))
              }
            />
          </label>
        );
      })}
      {!!styles.length && (
        <div className={cx("field")}>
          <span className={cx("field-name")}>{t.edit.palettes}</span>
          <div className={cx("palettes")}>
            {styles.map((s) => (
              <button
                key={s.id}
                data-tip={t.edit.usePalette(s.name[locale])}
                aria-label={t.edit.usePalette(s.name[locale])}
                onClick={() => void change((w) => setStyles(w, s.tokens))}
              >
                {["paper", "ink", "accent", "accent2"].map((k) =>
                  s.tokens[k] ? (
                    <i key={k} style={{ "--swatch": s.tokens[k] } as CSSProperties} />
                  ) : null,
                )}
                <span>{s.name[locale]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
/** One of the work's colours, changed for every part that takes it. */
function Token({
  name,
  value,
  set,
}: {
  name: string;
  value: string;
  set: (c: string) => void;
}) {
  const [shown, setShown] = useState(hex(value));
  return (
    <div className={cx("field")} data-inline>
      <span className={cx("field-name")}>{name}</span>
      <Picker plain label={name} value={shown} onChange={setShown} onDone={set} />
    </div>
  );
}

/** The scene being edited: its title and the scenes below it. The root scene's title is
 * the work's. */
export function SceneSettings({
  work,
  sceneId,
  change,
  openScene,
}: {
  work: Work;
  sceneId: string;
  change: Change;
  openScene: (id: string) => void;
}) {
  const t = useT();
  const scene = work.scenes[sceneId];
  const children = Object.values(work.scenes).filter((s) => s.parentId === sceneId);
  const [adding, setAdding] = useState("");
  const root = sceneId === work.rootSceneId;
  return (
    <div className={cx("fields")}>
      {!root && (
        <label className={cx("field")}>
          <span className={cx("field-name")}>{t.edit.scene.title}</span>
          <input
            key={scene.title}
            className={cx("edit-input")}
            defaultValue={scene.title}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== scene.title &&
              void change((w) => renameScene(w, sceneId, e.target.value))
            }
          />
        </label>
      )}
      <div className={cx("field")}>
        <span className={cx("field-name")}>{t.edit.scene.children}</span>
        <div className={cx("scene-children")}>
          {children.map((c) => (
            <button key={c.id} onClick={() => openScene(c.id)}>
              <CornerDownRight size={13} />
              <span>{c.title}</span>
              <small>{t.edit.scene.parts(c.modules.length)}</small>
              <ChevronRight size={13} />
            </button>
          ))}
          <span className={cx("tree-new")}>
            <input
              value={adding}
              placeholder={t.edit.scene.newChild}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && adding.trim()) {
                  void change((w) => addScene(w, sceneId, adding.trim()).edit);
                  setAdding("");
                }
              }}
            />
            <button
              aria-label={t.edit.scene.add}
              data-tip={t.edit.scene.add}
              disabled={!adding.trim()}
              onClick={() => {
                void change((w) => addScene(w, sceneId, adding.trim()).edit);
                setAdding("");
              }}
            >
              <Plus size={13} />
            </button>
          </span>
        </div>
      </div>
      {!root && (
        <button
          className={cx("edit-danger")}
          onClick={() => {
            if (!confirm(t.edit.scene.removeConfirm(scene.title))) return;
            const parent = scene.parentId!;
            void change((w) => removeScene(w, sceneId)).then(
              (done) => done && openScene(parent),
            );
          }}
        >
          <Trash2 size={14} />
          {t.edit.scene.remove}
        </button>
      )}
    </div>
  );
}

/** The script that runs in the scene: code, so it sits in a section of its own that starts
 * folded, out of the way of what most edits need. */
export function SceneScript({
  work,
  sceneId,
  change,
}: {
  work: Work;
  sceneId: string;
  change: Change;
}) {
  const t = useT();
  return (
    <Code
      key={"script:" + sceneId}
      label={t.edit.scene.script}
      value={work.scenes[sceneId].interaction ?? ""}
      rows={6}
      check={(code) => (code.trim() ? syntaxError(code) : null)}
      apply={(code) => change((w) => setInteraction(w, sceneId, code))}
    />
  );
}

/** The details of the work: the pages a click on a module opens, each with a title and
 * a page written in HTML. */
export function Details({ work, change }: { work: Work; change: Change }) {
  const t = useT();
  const [open, setOpen] = useState<string>();
  const [adding, setAdding] = useState("");
  return (
    <div className={cx("fields")}>
      {Object.values(work.details).map((d) => (
        <div key={d.id} className={cx("connection")} data-open={open === d.id || undefined}>
          <div className={cx("connection-head")}>
            <button aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? undefined : d.id)}>
              <ChevronRight size={14} />
              <FileText size={13} />
              <span>{d.title}</span>
            </button>
            <button
              aria-label={t.edit.details.remove}
              data-tip={t.edit.details.remove}
              data-tone="danger"
              onClick={() =>
                confirm(t.edit.details.removeConfirm(d.title)) &&
                void change((w) => removeDetail(w, d.id))
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
          {open === d.id && (
            <div className={cx("fields")} data-indent>
              <label className={cx("field")}>
                <span className={cx("field-name")}>{t.edit.details.title}</span>
                <input
                  key={d.title}
                  className={cx("edit-input")}
                  defaultValue={d.title}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value !== d.title &&
                    void change((w) => setDetail(w, { ...w.details[d.id], title: e.target.value.trim() }).edit)
                  }
                />
              </label>
              <div className={cx("field")}>
                <span className={cx("field-name")}>{t.edit.details.page}</span>
                <Code
                  label={t.edit.details.page}
                  value={d.html}
                  rows={8}
                  apply={(html) => change((w) => setDetail(w, { ...w.details[d.id], html }).edit)}
                />
              </div>
            </div>
          )}
        </div>
      ))}
      <span className={cx("tree-new")}>
        <input
          value={adding}
          placeholder={t.edit.details.newTitle}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && adding.trim()) add();
          }}
        />
        <button
          aria-label={t.edit.details.add}
          data-tip={t.edit.details.add}
          disabled={!adding.trim()}
          onClick={add}
        >
          <Plus size={13} />
        </button>
      </span>
    </div>
  );
  function add() {
    const title = adding.trim();
    setAdding("");
    let id = "";
    void change((w) => {
      const r = setDetail(w, { title, html: `<h2>${escape(title)}</h2>\n<p></p>` });
      id = r.id;
      return r.edit;
    }).then((done) => done && setOpen(id));
  }
}
const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The scene's modules as a list of layers, the topmost first: a click selects one
 * (Shift adds it), a double click renames it, and dragging one restacks it. Grouped
 * modules are marked with their group. The scene's links follow, each selected by a
 * click. */
export function Layers({
  work,
  sceneId,
  selected,
  link,
  canvas,
  change,
}: {
  work: Work;
  sceneId: string;
  selected: string[];
  link: string | null;
  canvas?: Canvas;
  change: Change;
}) {
  const t = useT();
  const scene = work.scenes[sceneId];
  const [naming, setNaming] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<{ id: string; above: boolean }>();
  const layers = [...scene.modules].reverse();
  const drawingName = (id: string) =>
    work.drawings[id]?.name ?? work.materials[id]?.name ?? id;
  if (!layers.length) return <p className={cx("edit-note")}>{t.edit.layers.empty}</p>;
  const nameOf = (id: string) => {
    const m = scene.modules.find((x) => x.id === id);
    return m ? shownName(work, m) : id;
  };
  return (
    <>
    <ol className={cx("layers")} onDragLeave={() => setOver(undefined)}>
      {layers.map((m) => {
        const chosen = selected.includes(m.id);
        return (
          <li
            key={m.id}
            draggable={naming !== m.id}
            aria-selected={chosen}
            data-over={over?.id === m.id ? (over.above ? "above" : "below") : undefined}
            data-dragging={dragging === m.id || undefined}
            onDragStart={(e) => {
              setDragging(m.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", m.id);
            }}
            onDragEnd={() => {
              setDragging(undefined);
              setOver(undefined);
            }}
            onDragOver={(e) => {
              if (!dragging || dragging === m.id) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setOver({ id: m.id, above: e.clientY < r.top + r.height / 2 });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragging || !over) return;
              const moving = selected.includes(dragging) ? selected : [dragging];
              // Above in the list is in front: dropped above a layer goes after it.
              const order = scene.modules.filter((x) => !moving.includes(x.id));
              const at = order.findIndex((x) => x.id === over.id);
              const before = over.above ? (order[at + 1]?.id ?? null) : over.id;
              void change((w) => restack(w, sceneId, moving, before));
              setDragging(undefined);
              setOver(undefined);
            }}
            onClick={(e) =>
              canvas?.select(
                e.shiftKey || e.metaKey || e.ctrlKey
                  ? chosen
                    ? selected.filter((id) => id !== m.id)
                    : [...selected, m.id]
                  : [m.id],
              )
            }
            onDoubleClick={() => setNaming(m.id)}
          >
            {naming === m.id ? (
              <input
                autoFocus
                className={cx("edit-input")}
                defaultValue={shownName(work, m)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setNaming(undefined);
                }}
                onBlur={(e) => {
                  setNaming(undefined);
                  // Leaving the name as it was shown changes nothing.
                  if (e.target.value !== shownName(work, m))
                    void change((w) => rename(w, sceneId, m.id, e.target.value));
                }}
              />
            ) : (
              <>
                <span className={cx("layer-name")}>{shownName(work, m)}</span>
                <small>{drawingName(m.drawingId)}</small>
                {m.group && (
                  <i data-tip={t.edit.layers.group(m.group)}>
                    <GroupIcon size={12} />
                  </i>
                )}
                {m.target && (
                  <i data-tip={t.edit.layers.leads}>
                    <CornerDownRight size={12} />
                  </i>
                )}
              </>
            )}
          </li>
        );
      })}
    </ol>
    {!!scene.links.length && (
      <>
        <h3 className={cx("layers-heading")}>{t.edit.links}</h3>
        <ol className={cx("layers")}>
          {scene.links.map((l) => (
            <li
              key={l.id}
              aria-selected={link === l.id}
              onClick={() => canvas?.selectLink(l.id)}
            >
              <i>
                <Spline size={13} />
              </i>
              <span className={cx("layer-name")}>
                {nameOf(l.from.moduleId)} → {nameOf(l.to.moduleId)}
              </span>
              <small>{drawingName(l.drawingId)}</small>
            </li>
          ))}
        </ol>
      </>
    )}
    </>
  );
}
