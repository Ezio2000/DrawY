import { detailElement } from "../../../modules/runtime/detail.ts";
import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize, MousePointer2, Hand } from "lucide-react";
import { Canvas } from "../../../modules/canvas/index.ts";
import type { Camera } from "../../../modules/contracts/geometry.ts";
import type {
  Work,
  Target,
  Selection,
  Bounds,
  Detail,
} from "../../../modules/contracts/index.ts";
import { cx } from "./cx.ts";
export function SceneView({
  work,
  sceneId,
  open,
  select,
  commit,
  disabled,
}: {
  work: Work;
  sceneId: string;
  disabled: boolean;
  open: (target: Target) => void;
  select: (value: Selection | null) => void;
  commit: (moves: { id: string; bounds: Bounds }[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<Canvas>(null),
    cameras = useRef(new Map<string, Camera>()),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const callbacks = useRef({ open, select, commit });
  const picked = useRef<{ key: string; moduleId: string } | null>(null);
  callbacks.current = { open, select, commit };
  useEffect(() => {
    setError("");
    const key = work.id + ":" + sceneId;
    const canvas = new Canvas(host.current!, work, work.scenes[sceneId], {
      camera: cameras.current.get(key),
      editing: editing && !disabled,
      open: (t) => callbacks.current.open(t),
      select: (s) => {
        picked.current = s ? { key, moduleId: s.moduleId } : null;
        callbacks.current.select(s);
      },
      commit: (m) => callbacks.current.commit(m),
      cameraChanged: (c) => cameras.current.set(key, c),
      error: setError,
    });
    view.current = canvas;
    let mounted = true;
    void canvas.ready
      .then(() => {
        if (!mounted) return;
        const id = picked.current?.key === key ? picked.current.moduleId : null;
        canvas.select(id && canvas.renderer.instances.has(id) ? id : null);
      })
      .catch((e) => setError(String(e)));
    return () => {
      mounted = false;
      canvas.dispose();
    };
  }, [work, sceneId]);
  useEffect(
    () => view.current?.setEditing(editing && !disabled),
    [editing, disabled],
  );
  return (
    <>
      <div ref={host} className={cx("drawy-canvas")} />
      <div className={cx("drawy-camera")}>
        <button
          disabled={disabled}
          title={editing ? "阅读" : "选择与移动"}
          onClick={() => setEditing(!editing)}
        >
          {editing ? <MousePointer2 size={17} /> : <Hand size={17} />}
        </button>
        <button title="缩小" onClick={() => view.current?.zoom(1 / 1.25)}>
          <ZoomOut size={17} />
        </button>
        <button title="放大" onClick={() => view.current?.zoom(1.25)}>
          <ZoomIn size={17} />
        </button>
        <button
          title="适应画布"
          onClick={() => {
            cameras.current.delete(work.id + ":" + sceneId);
            view.current?.fit();
          }}
        >
          <Maximize size={17} />
        </button>
      </div>
      {error && (
        <div role="alert" className={cx("drawy-render-error")}>
          {error}
        </div>
      )}
    </>
  );
}
export function DetailView({
  detail,
  close,
}: {
  detail: Detail;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const article = detailElement(detail, () => onClose.current());
    ref.current!.append(article);
    return () => article.remove();
  }, [detail]);
  return <div className={cx("drawy-detail")} ref={ref} />;
}
