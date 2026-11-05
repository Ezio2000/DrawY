import { SceneView, DetailView } from "./SceneView.tsx";
import { Studio, Now, live } from "./Studio.tsx";
import { ExportMenu } from "./Export.tsx";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Undo2,
  Redo2,
  ChevronDown,
  X,
  MessagesSquare,
  ImagePlus,
  PencilLine,
  History,
  Check,
} from "lucide-react";
import {
  Spinner,
  LocaleContext,
  Tooltips,
  Presence,
  UndoToast,
  Dialog,
  type Locale,
} from "@drawy/ui";
import { api, type Models, type Summary, type User } from "./api.ts";
import { AccountContext } from "./account.tsx";
import { cx } from "./cx.ts";
import { Rail, Rename } from "./Rail.tsx";
import { Auth } from "./Auth.tsx";
import { Composer, chosen, type Attachment } from "./Composer.tsx";
import { Library } from "./Library.tsx";
import { Settings } from "./Settings.tsx";
import {
  historyOf,
  stepBefore,
  versionOf,
  type Work,
  type WorkEdit,
  type Run,
  type Selection,
  type Target,
  type RevisionSummary,
} from "../../../modules/contracts/index.ts";
import type { Canvas, Pointed } from "../../../modules/canvas/index.ts";
import {
  applied,
  labelOf,
  shownName,
  moveParts,
  removeParts,
  replace,
  showable,
} from "../../../modules/editing/index.ts";
import { EditPanel, Retype } from "./Editor.tsx";
import { EditMenu, EditTools, SelectionBar } from "./EditMenu.tsx";
import { useHandEdits } from "./handEdits.ts";
import { listen } from "./events.ts";
import { leaving } from "./Settings.tsx";
import type {
  Material,
  PictureMaterial,
  StyleMaterial,
} from "@drawy/materials/schema";
import { TraceView } from "./TraceView.tsx";
import { Drafts } from "./Drafts.tsx";
import { Title } from "./Title.tsx";
import { Home } from "./Home.tsx";
import { ChooseLocale, dictionaries, useLanguage } from "./i18n.tsx";
type Page = "home" | "work" | "library" | "settings" | "traces";
const pageOf = (path: string): Page =>
  path.startsWith("/a/")
    ? "work"
    : path === "/library"
        ? "library"
        : path === "/settings"
          ? "settings"
          : path.startsWith("/traces")
            ? "traces"
            : "home";
/** Runs fetched from the server laid over the runs already shown: the fetched ones in their
 * order, each replaced by the shown one when that is newer, then any shown run the fetch
 * did not include, such as one started while it was on the way. */
function merged(fetched: Run[], shown: Run[], shownNewer: boolean) {
  const byId = new Map(shown.map((x) => [x.id, x]));
  const ids = new Set(fetched.map((x) => x.id));
  return [
    ...fetched.map((x) => (shownNewer ? byId.get(x.id) ?? x : x)),
    ...shown.filter((x) => !ids.has(x.id)),
  ];
}
const workIdOf = (path: string) => path.match(/^\/a\/([^/]+)/)?.[1];
/** A subscene has its own address under its work's, so the browser goes back up a level. */
const sceneOf = (path: string) => {
  const id = path.match(/^\/a\/[^/]+\/([^/]+)/)?.[1];
  return id && decodeURIComponent(id);
};
/** What the panel beside the canvas shows: the studio (the conversation with the author
 * and its process), the drafts (every revision, to look at or bring back) or the editor,
 * while the work is edited by hand. */
type Panel = "" | "journal" | "drafts" | "edit";
/** How wide the studio, the drafts panel and the editor are, each as the person last
 * dragged it: the conversation reads best wide, a list of drafts needs far less, and the
 * editor wants room for its fields without crowding the canvas. */
type Sized = "journal" | "drafts" | "edit";
const panelWidths: Record<Sized, { min: number; initial: number }> = {
  journal: { min: 360, initial: 520 },
  drafts: { min: 260, initial: 340 },
  edit: { min: 300, initial: 380 },
};
const panelWidth = {
  max: () => Math.max(420, Math.round(innerWidth * 0.62)),
  clamp: (kind: Sized, n: number) =>
    Math.min(panelWidth.max(), Math.max(panelWidths[kind].min, n)),
  read(kind: Sized) {
    try {
      const n = Number(localStorage.getItem("drawy.panel." + kind));
      return n ? panelWidth.clamp(kind, n) : panelWidths[kind].initial;
    } catch {
      return panelWidths[kind].initial;
    }
  },
  save(kind: Sized, n: number) {
    try {
      localStorage.setItem("drawy.panel." + kind, String(Math.round(n)));
    } catch {}
  },
};
/** Whether the panel can sit beside the canvas; on narrower screens it covers it. */
const roomy = () => innerWidth > 1080;
/** How a library material rides along with a message. */
const attachmentOf = (m: Material, locale: Locale): Attachment => ({
  id: m.id,
  kind: m.kind,
  name: m.name[locale],
  url:
    m.kind === "picture"
      ? m.file.url
      : m.kind === "style" && m.samples[0]
        ? `/materials/thumbs/${m.samples[0]}?size=96`
        : undefined,
});
export function App() {
  const [locale, setLocale] = useLanguage();
  const t = dictionaries[locale];
  const [user, U] = useState<User | null | undefined>(),
    [path, setPath] = useState(location.pathname),
    [error, E] = useState(""),
    [open, O] = useState(false),
    // Whether the list of works has arrived, so the home page does not say there are none
    // before it knows.
    [listed, setListed] = useState(false),
    [works, L] = useState<Summary[]>([]),
    [work, W] = useState<Work>(),
    // An earlier revision shown on the canvas in place of the current one.
    [preview, setPreview] = useState<{ revision: number; work: Work }>(),
    [history, H] = useState<RevisionSummary[]>([]),
    // The drawing models to pick from; until the chosen one is connected, nothing can
    // be drawn.
    [models, setModels] = useState<Models>(),
    // Something that went well, said briefly.
    [notice, setNotice] = useState(""),
    [runs, R] = useState<Run[]>([]),
    // The work whose run history has arrived; until then an empty journal is still loading.
    [runsOf, setRunsOf] = useState<string>(),
    [prompt, Q] = useState(""),
    [attachments, A] = useState<Attachment[]>([]),
    [uploading, setUploading] = useState(0),
    [style, setStyle] = useState<StyleMaterial>(),
    [selected, S] = useState<Selection[]>([]),
    // The link selected while editing, when no module is.
    [linkId, setLink] = useState<string | null>(null),
    // Words being changed where they are drawn.
    [retyping, setRetyping] = useState<Extract<Pointed, { kind: "text" }>>(),
    // A picture or a drawing being chosen from the library, and what it is for.
    [choosing, setChoosing] = useState<{
      kind: "picture" | "drawing";
      chosen: (m: Material) => void;
    }>(),
    [detailId, setDetail] = useState<string>(),
    [panel, setPanel] = useState<Panel>(""),
    [widths, setWidths] = useState(() => ({
      journal: panelWidth.read("journal"),
      drafts: panelWidth.read("drafts"),
      edit: panelWidth.read("edit"),
    })),
    [picking, setPicking] = useState(false),
    [scenes, M] = useState(false),
    [dismissed, setDismissed] = useState(""),
    [offline, G] = useState(false),
    [busy, B] = useState(false),
    [titling, setTitling] = useState(false),
    [dragging, setDragging] = useState(false),
    [trash, setTrash] = useState<Summary>(),
    // Options picked on the author's questions, sent with whatever the user writes.
    [choices, setChoices] = useState(""),
    // Why the composer holds a change written up for the author, until it is sent.
    [handed, setHanded] = useState(""),
    // A message held back while the person decides what becomes of their unsaved edits.
    [holding, setHolding] = useState<() => Promise<void>>(),
    // Going back to a version, to take back while the work is still where it left it.
    [wentBack, setWentBack] = useState<{ at: number; from: number; text: string }>();
  const page = pageOf(path);
  const journal = panel === "journal";
  const drafting = panel === "drafts";
  const editing = panel === "edit";
  const J = (on: boolean) => setPanel(on ? "journal" : "");
  const toggle = (p: Panel) => {
    setPanel(panel === p ? "" : p);
    setPreview(undefined);
  };
  const conversation = useRef<HTMLElement>(null);
  const following = useRef(true);
  const current = useRef(work);
  current.current = work;
  const canvas = useRef<Canvas>(undefined);
  const stage = useRef<HTMLElement>(null);
  // Hand edits go one after another, each made from the work the last one left.
  const edits = useRef<Promise<unknown>>(Promise.resolve());
  const inflight = useRef(0);
  // Revisions the person made themselves, shown at once rather than drawn.
  const own = useRef(new Set<number>());
  // Revisions undone, to bring back while the work is still where undoing left it.
  const [redoable, setRedoable] = useState<{ at: number; revisions: number[] }>();
  // Hand edits not saved yet, laid on the work so they show at once: the work they will
  // leave, and a count telling one showing from the next. Cleared once the last is saved.
  const [draft, setDraft] = useState<{ work: Work; n: number }>();
  const drafted = useRef<Work>(undefined);
  const queued = useRef(0);
  const shown = draft && work && draft.work.id === work.id ? draft.work : work;
  const deleting = useRef<{ id: string; timer: ReturnType<typeof setTimeout> }>(
    undefined,
  );
  const run = runs.at(-1),
    working = live(run);
  const loadingRuns = page === "work" && (!work || runsOf !== work.id);
  // While the author works or waits for an answer, the composer leaves the page for the
  // studio, without the model picks; it comes back once the run ends.
  const engaged = working || run?.status === "waiting";
  const addressed = sceneOf(path);
  const sceneId =
    work && addressed && work.scenes[addressed]
      ? addressed
      : (work?.rootSceneId ?? "root");
  const active = work?.scenes[sceneId];
  const sceneAddress = (id: string) =>
    "/a/" +
    work!.id +
    (id === work!.rootSceneId ? "" : "/" + encodeURIComponent(id));
  // A run that ends having drawn only in other scenes takes the viewer to the last one it
  // drew: left on the scene they asked from, people took the new subscene for nothing done.
  const watched = useRef<{ id: string; live: boolean }>(undefined);
  useEffect(() => {
    const was = watched.current;
    watched.current = run && { id: run.id, live: working };
    if (!run || !work || run.status !== "completed" || was?.id !== run.id || !was.live)
      return;
    const written = run.steps.flatMap((s) =>
      s.kind === "tool" && s.name === "write_work" && s.status === "done"
        ? s.scenes.map((x) => x.id)
        : [],
    );
    if (!written.length || written.includes(sceneId)) return;
    const target = written.findLast((id) => work.scenes[id]?.modules.length);
    if (target) go(sceneAddress(target));
  }, [run?.id, run?.status]);
  useEffect(() => {
    // An address naming a scene the work no longer has falls back to its root.
    if (work && addressed && !work.scenes[addressed])
      history_replace(sceneAddress(work.rootSceneId));
    if (detailId && work && !work.details[detailId]) setDetail(undefined);
  }, [work, addressed, detailId]);
  useEffect(() => {
    S([]);
    setLink(null);
    setDetail(undefined);
    M(false);
    setRetyping(undefined);
  }, [sceneId]);
  // While the author draws, the studio shows how it goes about it, unless the person is
  // editing by hand or the panel would cover the canvas.
  useEffect(() => {
    if (working && roomy()) setPanel((p) => (p === "edit" ? p : "journal"));
  }, [run?.id, working]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 2400);
    return () => clearTimeout(t);
  }, [notice]);
  // What people count as versions: one for each request or set of saved hand edits; the
  // edits made since the latest are not one until the person saves them.
  const { versions, unsaved } = useMemo(() => historyOf(history), [history]);
  // The history follows the work a moment later; until it does, it says nothing.
  const synced = !!work && history.some((r) => r.revision === work.revision);
  const unsavedCount = synced ? unsaved.length : 0;
  const undoable =
    !!work &&
    (wentBack?.at === work.revision || stepBefore(history, work.revision) !== undefined);
  const canRedo = !!work && redoable?.at === work.revision;
  const ids = selected.map((s) => s.moduleId);
  // Editing waits while the author works or an earlier revision is shown.
  const editless = loadingRuns || working || run?.status === "waiting" || !!preview;
  const manages = !!user?.permissions.includes("models.manage");
  const connected =
    models && !!models.labels.find((m) => m.id === models.chosen.label)?.ready;
  // No requests left to make; answering the author's questions still works.
  const spent = user?.quota === 0;
  useEffect(() => {
    if (!work) return H([]);
    void api<RevisionSummary[]>("/works/" + work.id + "/revisions").then(H, () => {});
  }, [work?.id, work?.revision]);
  // A preview ends when the work changes under it.
  useEffect(() => setPreview(undefined), [work?.id, work?.revision]);
  useEffect(() => {
    if (!user || (page !== "home" && page !== "work")) return;
    void api<Models>("/models").then(setModels, () => {});
  }, [user?.id, page]);
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      E("");
      await fn();
    } catch (e) {
      E(e instanceof Error ? e.message : String(e));
    }
  };
  /** Asks for a material of one kind from the library, for what it is chosen for. */
  const pickFrom = (kind: "picture" | "drawing", chosen: (m: Material) => void) =>
    setChoosing({ kind, chosen });
  const hand = useHandEdits({
    work,
    sceneId,
    selected: ids,
    link: linkId,
    editing,
    editless,
    canvas,
    change,
    attempt,
    pick: pickFrom,
    retype: setRetyping,
    upload: (file) => {
      const data = new FormData();
      data.append("file", file);
      return api<Material>("/materials", "POST", data);
    },
    t,
    locale,
  });
  const go = (to: string) => {
    if (to === location.pathname) return;
    if (!leaving()) return;
    window.history.pushState(null, "", to);
    setPath(to);
  };
  function history_replace(to: string) {
    window.history.replaceState(null, "", to);
    setPath(to);
  }
  const refreshList = () =>
    api<Summary[]>("/works").then((w) => {
      L(w);
      setListed(true);
    });
  async function load(id: string) {
    // The work shows as soon as it arrives; its runs, which can be long, follow.
    const runs = api<Run[]>("/works/" + id + "/runs");
    runs.catch(() => {});
    const w = await api<Work>("/works/" + id);
    W(w);
    setDetail(undefined);
    S([]);
    R([]);
    setRunsOf(undefined);
    const r = await runs;
    // A work left while its runs were on the way keeps out of the next one.
    if (workIdOf(location.pathname) !== id) return;
    // Runs started or updated while the history was on the way are newer than it: they
    // keep their state, and the history fills in what came before them.
    R((now) => merged(r, now, true));
    setRunsOf(id);
    // A reply from an earlier visit stays in the journal, not under the canvas; one still
    // to come shows when it arrives.
    const last = r.at(-1);
    setDismissed(last && !live(last) && last.status !== "waiting" ? last.id : "");
  }
  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => U(r.ok ? await r.json() : null))
      .catch((e) => E(e.message));
    const pop = () => setPath(location.pathname);
    addEventListener("popstate", pop);
    // A deletion waiting to be taken back happens now if the page is closed.
    const flush = () => {
      const pending = deleting.current;
      if (pending)
        void fetch("/api/works/" + pending.id, {
          method: "DELETE",
          keepalive: true,
        });
    };
    addEventListener("pagehide", flush);
    return () => {
      removeEventListener("popstate", pop);
      removeEventListener("pagehide", flush);
    };
  }, []);
  // The page follows the address: a work's address opens it, leaving it closes it.
  useEffect(() => {
    if (!user) return;
    const id = workIdOf(path);
    if (id && id !== current.current?.id)
      void attempt(async () => {
        W(undefined);
        await load(id);
      });
    if (!id && current.current) {
      W(undefined);
      setDetail(undefined);
      R([]);
      S([]);
      setPanel("");
    }
  }, [path, user?.id]);
  useEffect(() => {
    if (!user) return;
    void attempt(refreshList);
    return listen(user.id, (event) => {
      if (event.type === "connected") {
        void refreshList();
        if (current.current)
          void Promise.all([
            api<Work>("/works/" + current.current.id),
            api<Run[]>("/works/" + current.current.id + "/runs"),
          ]).then(([w, r]) => {
            W(w);
            // What the server says now is what was missed while disconnected; a run
            // started since the request went out is kept.
            R((now) => merged(r, now, false));
          });
        return;
      }
      if (event.type === "work") {
        if (event.work.id === current.current?.id) W(event.work);
        void refreshList();
      }
      if (event.type === "run")
        L((list) =>
          list.map((w) =>
            w.id === event.run.workId && w.progress.run !== event.run.status
              ? { ...w, progress: { ...w.progress, run: event.run.status } }
              : w,
          ),
        );
      if (event.type === "run" && event.run.workId === current.current?.id) {
        R((old) => {
          const found = old.some((r) => r.id === event.run.id);
          return found
            ? old.map((r) => (r.id === event.run.id ? event.run : r))
            : [...old, event.run];
        });
        if (!live(event.run)) void refreshList();
      }
    }, G);
  }, [user?.id]);
  useEffect(() => {
    const el = conversation.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
  }, [journal]);
  useEffect(() => {
    const el = conversation.current;
    if (el && following.current)
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [runs]);
  useEffect(() => {
    if (!scenes) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-scene-menu]")) M(false);
    };
    addEventListener("pointerdown", close);
    return () => removeEventListener("pointerdown", close);
  }, [scenes]);
  useEffect(() => {
    if (!open && !scenes) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      O(false);
      M(false);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open, scenes]);
  // An error says its piece and goes.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => E(""), 8000);
    return () => clearTimeout(t);
  }, [error]);
  // The author's last reply under the canvas goes with Escape or a press on the drawing.
  const replying =
    !!run && !working && run.status !== "waiting" && run.id !== dismissed;
  // Cmd/Ctrl+Z takes back the latest step and Shift+Cmd/Ctrl+Z (or Ctrl+Y) brings it back,
  // unless a field is being typed in.
  useEffect(() => {
    if (!work) return;
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (
        !(e.metaKey || e.ctrlKey) ||
        (k !== "z" && k !== "y") ||
        (e.target as Element).closest("input,textarea,[contenteditable]")
      )
        return;
      e.preventDefault();
      if (working || preview) return;
      if (k === "y" || e.shiftKey) {
        if (canRedo) void attempt(redo);
      } else if (undoable) void attempt(undo);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [work, undoable, canRedo, working, preview, wentBack]);
  // Cmd/Ctrl+S saves the hand edits as a version.
  useEffect(() => {
    if (!unsavedCount) return;
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (!editless) void attempt(saveEdits);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [unsavedCount, editless]);
  // Going back can be taken back for a while, from the note that says it happened.
  useEffect(() => {
    if (!wentBack) return;
    const t = setTimeout(() => setWentBack(undefined), 10000);
    return () => clearTimeout(t);
  }, [wentBack]);
  useEffect(() => {
    if (!preview) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPreview(undefined);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [preview]);
  useEffect(() => {
    if (!replying || journal || detailId) return;
    const key = (e: KeyboardEvent) =>
      e.key === "Escape" && setDismissed(run!.id);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [replying, journal, detailId]);
  async function upload(files: FileList | File[]) {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!images.length) throw Error(t.composer.imagesOnly);
    setUploading((n) => n + images.length);
    let left = images.length;
    try {
      for (const file of images) {
        const data = new FormData();
        data.append("file", file);
        const m = await api<Material>("/materials", "POST", data);
        A((old) => [...old, attachmentOf(m, locale)]);
        left--;
        setUploading((n) => n - 1);
      }
    } finally {
      setUploading((n) => n - left);
    }
  }
  async function send(text = prompt, target = sceneId, picked = choices, decided = false) {
    if ((!text.trim() && !attachments.length) || loadingRuns || busy || working || uploading) return;
    if (spent && run?.status !== "waiting") throw Error(t.composer.quotaOut);
    // Hand edits not saved yet wait for the person to say what becomes of them, since the
    // author would otherwise take them into its own version.
    if (!decided && work && (unsavedCount || queued.current)) {
      setHolding(() => () => send(text, target, picked, true));
      return;
    }
    if (!connected) {
      if (manages) go("/settings");
      return;
    }
    B(true);
    try {
      let w = work;
      const message =
        !w && style ? `${text.trim()}\n${t.home.styleLine(style.name[locale])}` : text;
      if (!w) {
        w = await api<Work>("/works", "POST", {
          title: (text.trim() || attachments[0].name).slice(0, 36),
        });
        W(w);
        setRunsOf(w.id);
        target = w.rootSceneId;
        go("/a/" + w.id);
      }
      const request = selected.length
        ? `${message}\n${selected.map((s) => `Selected module: ${s.moduleId}\n${s.label}`).join("\n")}`
        : chosenLink
          ? `${message}\nSelected link: ${chosenLink.id} (${chosenLink.from.moduleId} → ${chosenLink.to.moduleId})`
          : message;
      const r =
        run?.status === "waiting"
          ? await api<Run>("/runs/" + run.id + "/answer", "POST", {
              answer: [picked, request].filter(Boolean).join("\n"),
              materials: attachments.map((a) => a.id),
            })
          : await api<Run>("/works/" + w.id + "/runs", "POST", {
              prompt: request,
              sceneId: target,
              materials: attachments.map((a) => a.id),
            });
      R((old) =>
        old.some((x) => x.id === r.id)
          ? old.map((x) => (x.id === r.id ? r : x))
          : [...old, r],
      );
      // A new request took one from the allowance; an answer did not.
      if (run?.status !== "waiting")
        U((u) => (u && u.quota !== null ? { ...u, quota: Math.max(0, u.quota - 1) } : u));
      Q("");
      A([]);
      setStyle(undefined);
      setChoices("");
      setHanded("");
      await refreshList();
    } finally {
      B(false);
    }
  }
  async function enter(id: string, title?: string) {
    if (!work?.scenes[id]) {
      throw Error(t.work.noScene);
    }
    go(sceneAddress(id));
    if (!work.scenes[id].modules.length && !working)
      await send(t.work.expand(title || work.scenes[id].title), id);
  }
  /** Goes back to a version: the work is as it was then, and the versions after it leave
   * the list. It shows at once, and can be taken back from the note that says so. */
  async function restore(revision: number) {
    await edits.current;
    const from = work!.revision;
    const number = versionOf(versions, revision)?.number;
    const w = await mine(() =>
      api<Work>("/works/" + work!.id + "/restore", "POST", { revision }),
    );
    W(w);
    setPreview(undefined);
    setRedoable(undefined);
    setWentBack(
      number !== undefined ? { at: w.revision, from, text: t.history.wentBack(number) } : undefined,
    );
    if (run) setDismissed(run.id);
  }
  /** Takes back going back to a version: the versions it left come back. */
  async function undoBack() {
    const back = wentBack!;
    setWentBack(undefined);
    W(
      await mine(() =>
        api<Work>("/works/" + work!.id + "/restore", "POST", { revision: back.from }),
      ),
    );
  }
  /** Saves the hand edits made since the latest version as a version of their own. */
  async function saveEdits() {
    await edits.current;
    const number = (versions.at(-1)?.number ?? 0) + 1;
    W(await mine(() => api<Work>("/works/" + work!.id + "/save", "POST")));
    setRedoable(undefined);
    setWentBack(undefined);
    setNotice(t.unsaved.saved(number));
  }
  /** Throws the hand edits made since the latest version away. */
  async function discardEdits() {
    await edits.current;
    const latest = versions.at(-1);
    if (!latest) return;
    const from = work!.revision;
    const w = await mine(() =>
      api<Work>("/works/" + work!.id + "/restore", "POST", { revision: latest.revision }),
    );
    W(w);
    setRedoable(undefined);
    setWentBack({ at: w.revision, from, text: t.unsaved.discarded });
  }
  /** Takes back the latest request, or hand edit, as a whole; it can be brought back
   * until the work changes otherwise. Both show at once, like the edits they undo. */
  async function undo() {
    if (wentBack?.at === work!.revision) return undoBack();
    const from = work!.revision;
    const w = await mine(() => api<Work>("/works/" + work!.id + "/undo", "POST"));
    setRedoable((old) => ({
      at: w.revision,
      revisions: [...(old?.at === from ? old.revisions : []), from],
    }));
    W(w);
    if (run) setDismissed(run.id);
  }
  async function redo() {
    const revisions = redoable!.revisions;
    const w = await mine(() =>
      api<Work>("/works/" + work!.id + "/restore", "POST", {
        revision: revisions.at(-1),
      }),
    );
    setRedoable(
      revisions.length > 1 ? { at: w.revision, revisions: revisions.slice(0, -1) } : undefined,
    );
    W(w);
  }
  /** Runs a change the person makes, marking the revision it saves as theirs. */
  async function mine(save: () => Promise<Work>) {
    inflight.current++;
    try {
      const w = await save();
      own.current.add(w.revision);
      current.current = w;
      return w;
    } finally {
      inflight.current--;
    }
  }
  /** Commits a hand edit, made from the work as the edits before it left it. It shows at
   * once, laid on what the edits before it will leave, unless it takes in a material the
   * work does not hold yet; the saved work replaces it when the last edit is saved, and
   * a failed edit takes back what was shown. */
  function change(make: (w: Work) => WorkEdit | null) {
    const base = drafted.current ?? current.current;
    if (base) {
      try {
        const guess = make(base);
        if (guess && showable(base, guess)) {
          const next = applied(base, guess);
          drafted.current = next;
          setDraft((d) => ({ work: next, n: (d?.n ?? 0) + 1 }));
        }
      } catch {
        // The edit says why when it is made for real.
      }
    }
    queued.current++;
    const job = edits.current
      .then(async () => {
        const w = current.current;
        if (!w) return false;
        const edit = make(w);
        if (!edit) return false;
        const saved = await mine(() =>
          api<Work>("/works/" + w.id + "/edits", "POST", { baseRevision: w.revision, edit }),
        );
        setRedoable(undefined);
        W(saved);
        return true;
      })
      .catch((e) => {
        drafted.current = undefined;
        setDraft(undefined);
        throw e;
      })
      .finally(() => {
        if (--queued.current) return;
        drafted.current = undefined;
        setDraft(undefined);
      });
    edits.current = job.catch(() => {});
    return job;
  }
  /** Words or a picture pointed at on the canvas: words are changed where they are, a
   * picture is swapped for one from the library. What the work cannot change by itself is
   * written up for the author to do. */
  function point(p: Pointed) {
    if (editless) return;
    if (!editing) setPanel("edit");
    if (p.kind === "text") return setRetyping(p);
    pickFrom("picture", (m) =>
      void attempt(async () => {
        const done = await change((w) =>
          replace(w, sceneId, p.moduleId, "picture", p.material, m.id),
        );
        if (!done) {
          A((old) => (old.some((a) => a.id === m.id) ? old : [...old, attachmentOf(m, locale)]));
          ask(t.edit.askPicture(nameOf(p.moduleId)), t.edit.handedPicture);
        }
      }),
    );
  }
  function retyped(text: string | null) {
    const p = retyping!;
    setRetyping(undefined);
    if (text === null || text === p.text) return;
    if (!text.trim())
      return void attempt(() => change((w) => removeParts(w, sceneId, [p.moduleId])));
    void attempt(async () => {
      if (!(await change((w) => replace(w, sceneId, p.moduleId, "text", p.text, text))))
        ask(t.edit.askText(nameOf(p.moduleId), p.text, text), t.edit.handedText);
    });
  }
  /** A module by its name, or a link by the names of the modules it joins. */
  const nameOf = (id: string): string => {
    const link = active?.links.find((l) => l.id === id);
    if (link) return `${nameOf(link.from.moduleId)} → ${nameOf(link.to.moduleId)}`;
    const m = active?.modules.find((x) => x.id === id);
    return m ? shownName(work!, m) : id;
  };
  const chosenLink = !selected.length && linkId ? active?.links.find((l) => l.id === linkId) : undefined;
  /** Hands a change to the author, written into the composer for the person to send, and
   * says why. */
  function ask(text?: string, why = "") {
    if (text) Q(text);
    setHanded(why);
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>("[data-dock] textarea")?.focus(),
    );
  }
  async function look(revision: number) {
    // Looking at a version, and coming back from it, swaps the picture in place rather
    // than drawing it again.
    own.current.add(work!.revision);
    if (revision === work!.revision) return setPreview(undefined);
    own.current.add(revision);
    setPreview({
      revision,
      work: await api<Work>(`/works/${work!.id}/revisions/${revision}`),
    });
  }
  /** Stopping hands what was asked back to the composer, to change and send again. */
  async function stop() {
    const asked = run!.steps.findLast(
      (s) => s.kind === "message" && s.role === "user",
    );
    await api("/runs/" + run!.id + "/cancel", "POST");
    if (asked?.kind === "message" && !prompt.trim()) Q(asked.text);
  }
  async function rename(id: string, title: string) {
    L((old) => old.map((w) => (w.id === id ? { ...w, title } : w)));
    const w = await api<Work>("/works/" + id, "PATCH", { title });
    if (current.current?.id === id) W(w);
  }
  /** Deletes for real a few seconds later, unless the user takes it back. */
  function remove(w: Summary) {
    const pending = deleting.current;
    if (pending) {
      // The earlier one can no longer be taken back: take it out of the list
      // now, or it reappears once `trash` moves on to this work.
      clearTimeout(pending.timer);
      L((old) => old.filter((o) => o.id !== pending.id));
      void api("/works/" + pending.id, "DELETE").catch(() => refreshList());
    }
    if (work?.id === w.id) go("/");
    setTrash(w);
    deleting.current = {
      id: w.id,
      timer: setTimeout(() => {
        deleting.current = undefined;
        L((old) => old.filter((o) => o.id !== w.id));
        setTrash(undefined);
        void attempt(async () => {
          await api("/works/" + w.id, "DELETE");
          await refreshList();
        });
      }, 5000),
    };
  }
  function keep() {
    clearTimeout(deleting.current?.timer);
    deleting.current = undefined;
    setTrash(undefined);
  }
  function use(m: Material) {
    if (m.kind === "style") setStyle(m);
    else
      A((old) =>
        old.some((a) => a.id === m.id) ? old : [...old, attachmentOf(m, locale)],
      );
    setPicking(false);
    if (page !== "work" && page !== "home") go("/");
  }
  const crumbs = [];
  let at = active;
  while (at) {
    crumbs.unshift(at);
    at = at.parentId ? work?.scenes[at.parentId] : undefined;
  }
  const shownWorks = works.filter((w) => w.id !== trash?.id);
  /** A blank canvas, made and opened: from the side bar and from the home page. */
  const createBlank = () =>
    void attempt(async () => {
      const w = await api<Work>("/works", "POST", { title: t.rail.untitled });
      W(w);
      setRunsOf(w.id);
      R([]);
      go("/a/" + w.id);
      await refreshList();
    });
  // While drawing, the bar always shows how far it has got; with the studio open, which
  // tells the rest, only the stages.
  const status = work &&
    (offline ||
      run?.status === "waiting" ||
      working ||
      (!journal && run?.id !== dismissed)) && (
      <Now
        compact={journal && working}
        run={run}
        work={work}
        offline={offline}
        pictures={!!active?.modules.length}
        answer={(o) => void attempt(() => send(o, sceneId, ""))}
        choose={setChoices}
        cancel={() =>
          void attempt(() => api("/runs/" + run!.id + "/cancel", "POST"))
        }
        reveal={() => J(true)}
        dismiss={() => setDismissed(run?.id || "")}
        resume={() => void attempt(() => send(t.now.resumeMessage, run?.sceneId ?? sceneId, ""))}
        restore={(r) => void attempt(() => restore(r))}
      />
    );
  // Until a drawing model is connected, the composer says so: those who manage models
  // are led to Settings, the rest are told an administrator has to.
  const unconnected = connected === false && (
    <div className={cx("now")} data-tone="failed">
      <span className={cx("now-line")}>
        {manages ? t.composer.unconnected : t.composer.unconnectedMember}
      </span>
      {manages && (
        <button className={cx("primary small")} onClick={() => go("/settings")}>
          {t.composer.connect}
        </button>
      )}
    </div>
  );
  const note = handed && prompt && (
    <div className={cx("now")}>
      <span className={cx("now-line")}>{handed}</span>
    </div>
  );
  // The composer sits at the bottom of the page, its model picks under it; while the author
  // draws it folds down to what is happening and the button that stops it.
  const composer = (place: "home" | "dock") => (
    <Composer
      place={place}
      value={prompt}
      set={Q}
      attachments={attachments}
      detach={(id) => A((old) => old.filter((a) => a.id !== id))}
      uploading={uploading}
      quote={
        place !== "home" && selected.length
          ? selected.map((s) => s.label || s.moduleId).join(t.now.list)
          : place !== "home" && chosenLink
            ? nameOf(chosenLink.id)
            : undefined
      }
      unquote={() => canvas.current?.select([])}
      edit={editing || editless ? undefined : () => setPanel("edit")}
      placeholder={
        place === "home"
          ? t.home.placeholder
          : run?.status === "waiting"
            ? t.composer.answering
            : selected.length || chosenLink
              ? t.composer.selected
              : working
                ? t.composer.working
                : t.composer.continue
      }
      status={unconnected || (place !== "home" ? note || status : undefined)}
      style={place === "home" ? style : undefined}
      setStyle={place === "home" ? setStyle : undefined}
      working={working}
      busy={busy || loadingRuns}
      send={() => void attempt(() => send())}
      stop={() => void attempt(stop)}
      attach={(files) => void attempt(() => upload(files))}
      pick={() => setPicking(true)}
      models={engaged ? undefined : models}
      collapsed={place === "dock" && working}
      quota={user?.quota}
      spent={spent && run?.status !== "waiting"}
      choose={(change) => {
        setModels((m) => m && chosen(m, change));
        // What the server settles on (a label taken away falls back) is shown next.
        void attempt(async () => {
          await api("/settings", "PUT", change);
          setModels(await api<Models>("/models"));
        });
      }}
    />
  );
  const droppable = page === "home" || page === "work";
  return (
    <LocaleContext.Provider value={locale}>
      <AccountContext.Provider value={user ?? null}>
      <ChooseLocale.Provider value={setLocale}>
      <Tooltips />
      <div className={cx("app")}>
        {user && (
          <Rail
            user={user}
            open={open}
            setOpen={O}
            page={page}
            works={shownWorks}
            current={work?.id}
            go={go}
            create={createBlank}
            remove={remove}
            logout={() =>
              void attempt(async () => {
                await api("/auth/logout", "POST");
                L([]);
                setListed(false);
                U(null);
                go("/");
              })
            }
          />
        )}
        {open && <div className={cx("rail-scrim")} onClick={() => O(false)} />}
        <main
          className={cx("app-main")}
          data-bare={!user || undefined}
          onDragEnter={(e) => {
            if (droppable && e.dataTransfer.types.includes("Files"))
              setDragging(true);
          }}
          onDragOver={(e) => droppable && e.preventDefault()}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={(e) => {
            if (!droppable) return;
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length)
              void attempt(() => upload(e.dataTransfer.files));
          }}
        >
          {user === undefined ? (
            <div className={cx("loading")}>
              <Spinner />
            </div>
          ) : !user ? (
            <Auth
              done={(u) => {
                U(u);
                setPath(location.pathname);
              }}
            />
          ) : page === "traces" ? (
            <TraceView />
          ) : page === "settings" ? (
            <Settings />
          ) : page === "library" ? (
            <div className={cx("page")}>
              <header className={cx("page-head")}>
                <h1>
                  <Title name="library" />
                </h1>
              </header>
              <Library use={use} action={t.work.useIt} />
            </div>
          ) : page === "home" ? (
            <Home
              works={shownWorks}
              start={(text) => void attempt(() => send(text))}
              blank={createBlank}
              listed={listed}
              all={() => O(true)}
              open={(id) => go("/a/" + id)}
              composer={composer("home")}
            />
          ) : !work ? (
            <div className={cx("loading")}>
              <Spinner />
            </div>
          ) : (
            <div
              className={cx("workspace")}
              data-panel={panel || undefined}
              style={
                {
                  "--journal": widths.journal + "px",
                  "--drafts": widths.drafts + "px",
                  "--edit": widths.edit + "px",
                } as CSSProperties
              }
            >
              <section
                ref={stage}
                className={cx("stage")}
                data-working={working || undefined}
                onPointerDown={(e) => {
                  if (
                    replying &&
                    (e.target as Element).closest("[data-canvas]")
                  )
                    setDismissed(run!.id);
                }}
              >
                <header className={cx("topbar")}>
                  <nav className={cx("crumbs")}>
                    {crumbs.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && <i>/</i>}
                        {i === 0 && titling ? (
                          <Rename
                            title={work.title}
                            done={(title) => {
                              setTitling(false);
                              if (title)
                                void attempt(() => rename(work.id, title));
                            }}
                          />
                        ) : (
                          <button
                            aria-current={p.id === sceneId || undefined}
                            data-tip={
                              i === 0 && p.id === sceneId
                                ? t.work.rename
                                : undefined
                            }
                            onClick={() =>
                              i === 0 && p.id === sceneId
                                ? setTitling(true)
                                : void attempt(() => enter(p.id))
                            }
                          >
                            {i === 0 ? work.title : p.title}
                          </button>
                        )}
                      </span>
                    ))}
                    {Object.keys(work.scenes).length > 1 && (
                      <span className={cx("scene-menu")} data-scene-menu>
                        <button
                          aria-label={t.work.scenes}
                          aria-expanded={scenes}
                          onClick={() => M(!scenes)}
                        >
                          <ChevronDown size={15} />
                        </button>
                        {scenes && (
                          <span className={cx("scene-list")}>
                            {Object.values(work.scenes).map((p) => (
                              <button
                                key={p.id}
                                data-child={!!p.parentId || undefined}
                                aria-current={p.id === sceneId || undefined}
                                onClick={() => void attempt(() => enter(p.id))}
                              >
                                {p.parentId ? p.title : work.title}
                              </button>
                            ))}
                          </span>
                        )}
                      </span>
                    )}
                  </nav>
                </header>
                <SceneView
                  key={work.id}
                  work={
                    preview?.work.scenes[sceneId] ? preview.work : shown!
                  }
                  version={!preview && draft ? "~" + draft.n : ""}
                  sceneId={sceneId}
                  run={working || run?.status === "waiting" ? run : undefined}
                  disabled={editless}
                  editing={editing}
                  quiet={(revision) =>
                    !!drafted.current ||
                    inflight.current > 0 ||
                    own.current.has(revision)
                  }
                  view={(c) => (canvas.current = c)}
                  open={(target: Target) =>
                    target.kind === "scene"
                      ? void attempt(() => enter(target.id))
                      : setDetail(target.id)
                  }
                  select={S}
                  commit={(moves) =>
                    void attempt(async () => {
                      if (working) throw Error(t.work.wait);
                      await change((w) => moveParts(w, sceneId, moves));
                    })
                  }
                  point={point}
                  connect={hand.ops.connect}
                  selectLink={setLink}
                  reconnect={hand.ops.reconnect}
                  menu={hand.setMenu}
                  place={(at) => {
                    hand.setTool("select");
                    hand.ops.add("text", at);
                  }}
                />
                {editing && !editless && (
                  <EditTools tool={hand.tool} setTool={hand.setTool} ops={hand.ops} />
                )}
                {editing && !editless && (
                  <SelectionBar
                    canvas={canvas.current}
                    stage={stage.current}
                    ops={hand.ops}
                    selected={ids}
                    link={chosenLink ? linkId : null}
                    grouped={
                      !!selected.length &&
                      selected.every((s) => {
                        const g = active?.modules.find((m) => m.id === s.moduleId)?.group;
                        return g && g === active?.modules.find((m) => m.id === selected[0].moduleId)?.group;
                      })
                    }
                    hidden={!!hand.menu || !!retyping || hand.tool !== "select"}
                    ask={() => ask()}
                  />
                )}
                {hand.menu && editing && !editless && (
                  <EditMenu
                    at={hand.menu}
                    ops={hand.ops}
                    selected={ids}
                    link={chosenLink ? linkId : null}
                    grouped={selected.some(
                      (s) => active?.modules.find((m) => m.id === s.moduleId)?.group,
                    )}
                    clipped={hand.clipped}
                    close={() => hand.setMenu(undefined)}
                    ask={() => ask()}
                  />
                )}
                {retyping && stage.current && (
                  <Retype
                    key={retyping.moduleId + ":" + retyping.text}
                    pointed={retyping}
                    stage={stage.current}
                    done={retyped}
                  />
                )}
                <div className={cx("dock")} data-dock>
                  {preview && (
                    <div className={cx("preview-bar")} role="status">
                      <span>
                        {t.history.previewing(
                          versionOf(versions, preview.revision)?.number ?? 0,
                        )}
                      </span>
                      <button
                        className={cx("secondary small")}
                        onClick={() => setPreview(undefined)}
                      >
                        {t.history.back}
                      </button>
                      <button
                        className={cx("primary small")}
                        disabled={working}
                        onClick={() =>
                          void attempt(() => restore(preview.revision))
                        }
                      >
                        {t.history.restoreThis}
                      </button>
                    </div>
                  )}
                  {error && (
                    <div className={cx("toast-error")} role="alert">
                      <span>{error}</span>
                      <button aria-label={t.close} onClick={() => E("")}>
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  {notice && !wentBack && (
                    <div className={cx("toast-error")} data-tone="ok" role="status">
                      <span>{notice}</span>
                    </div>
                  )}
                  {wentBack?.at === work.revision && !preview && !holding && (
                    <div className={cx("toast-error")} data-tone="ok" role="status">
                      <span>{wentBack.text}</span>
                      <button
                        className={cx("toast-action")}
                        onClick={() => void attempt(undoBack)}
                      >
                        {t.history.undoBack}
                      </button>
                    </div>
                  )}
                  {holding ? (
                    <div className={cx("unsaved-bar")} data-asking role="alertdialog">
                      <span className={cx("unsaved-text")}>
                        <i className={cx("unsaved-dot")} />
                        {t.unsaved.ask(Math.max(1, unsavedCount))}
                      </span>
                      <span className={cx("unsaved-actions")}>
                        <button
                          className={cx("quiet-button")}
                          onClick={() => setHolding(undefined)}
                        >
                          {t.unsaved.cancel}
                        </button>
                        <button
                          className={cx("secondary small")}
                          onClick={() => {
                            const go = holding;
                            setHolding(undefined);
                            void attempt(async () => {
                              await discardEdits();
                              await go();
                            });
                          }}
                        >
                          {t.unsaved.discardAndSend}
                        </button>
                        <button
                          className={cx("primary small")}
                          onClick={() => {
                            const go = holding;
                            setHolding(undefined);
                            void attempt(async () => {
                              await saveEdits();
                              await go();
                            });
                          }}
                        >
                          {t.unsaved.saveAndSend}
                        </button>
                      </span>
                    </div>
                  ) : (
                    !!unsavedCount &&
                    !preview &&
                    !engaged && (
                      <div className={cx("unsaved-bar")} role="status">
                        <span className={cx("unsaved-text")}>
                          <i className={cx("unsaved-dot")} />
                          <b>{t.unsaved.title(unsavedCount)}</b>
                        </span>
                        <span className={cx("unsaved-actions")}>
                          <button
                            className={cx("quiet-button")}
                            disabled={editless}
                            onClick={() => void attempt(discardEdits)}
                          >
                            {t.unsaved.discardAll}
                          </button>
                          <button
                            className={cx("primary small")}
                            disabled={editless}
                            data-tip={t.unsaved.shortcut}
                            onClick={() => void attempt(saveEdits)}
                          >
                            <Check size={13} />
                            {t.unsaved.save((versions.at(-1)?.number ?? 0) + 1)}
                          </button>
                        </span>
                      </div>
                    )
                  )}
                  {composer("dock")}
                </div>
                {detailId && work.details[detailId] && (
                  <DetailView
                    detail={work.details[detailId]}
                    close={() => setDetail(undefined)}
                  />
                )}
              </section>
              <aside className={cx("side")} aria-label={t.work.panel}>
                <nav className={cx("side-tools")}>
                  <button
                    aria-label={t.work.undo}
                    data-tip={t.work.undo}
                    disabled={working || !undoable}
                    onClick={() => void attempt(undo)}
                  >
                    <Undo2 size={17} />
                  </button>
                  <button
                    aria-label={t.work.redo}
                    data-tip={t.work.redo}
                    disabled={working || !canRedo}
                    onClick={() => void attempt(redo)}
                  >
                    <Redo2 size={17} />
                  </button>
                  <button
                    aria-label={t.work.edit}
                    data-tip={t.work.edit}
                    aria-pressed={editing}
                    onClick={() => toggle("edit")}
                  >
                    <PencilLine size={17} />
                  </button>
                  <button
                    aria-label={t.work.journal}
                    data-tip={t.work.journal}
                    aria-pressed={journal}
                    data-live={working || undefined}
                    onClick={() => toggle("journal")}
                  >
                    <MessagesSquare size={17} />
                  </button>
                  <button
                    aria-label={t.work.drafts}
                    data-tip={t.work.drafts}
                    aria-pressed={drafting}
                    onClick={() => toggle("drafts")}
                  >
                    <History size={17} />
                  </button>
                  <ExportMenu
                    work={work}
                    sceneId={sceneId}
                    disabled={!active?.modules.length}
                    fail={(e) => E(e instanceof Error ? e.message : String(e))}
                    done={setNotice}
                  />
                </nav>
                <div className={cx("side-panel")} data-kind={panel || undefined} inert={!panel}>
                  {panel && (
                    <Resizer
                      kind={editing ? "edit" : drafting ? "drafts" : "journal"}
                      width={editing ? widths.edit : drafting ? widths.drafts : widths.journal}
                      set={(kind, n) => setWidths((w) => ({ ...w, [kind]: n }))}
                      label={t.work.resize}
                    />
                  )}
                  <header>
                    <h2>
                      <Title
                        name={editing ? "edit" : drafting ? "drafts" : "journal"}
                        size="section"
                      />
                    </h2>
                  </header>
                  <section
                    className={cx("side-body")}
                    ref={conversation}
                    onWheel={(e) => {
                      if (!journal) return;
                      const el = e.currentTarget;
                      following.current =
                        e.deltaY > 0 &&
                        el.scrollHeight - el.scrollTop - el.clientHeight < 160;
                    }}
                  >
                    {editing ? (
                      <EditPanel
                        work={shown!}
                        sceneId={sceneId}
                        selected={ids}
                        link={chosenLink ? linkId : null}
                        canvas={canvas.current}
                        busy={
                          working || run?.status === "waiting"
                            ? t.edit.busy
                            : undefined
                        }
                        change={(make) => attempt(() => change(make)).then(() => true)}
                        ops={hand.ops}
                        pick={pickFrom}
                        openScene={(id) => void attempt(() => enter(id))}
                        ask={() => ask()}
                      />
                    ) : drafting ? (
                      <Drafts
                        versions={versions}
                        unsaved={unsavedCount}
                        current={work.revision}
                        previewing={preview?.revision}
                        locked={engaged || loadingRuns}
                        look={(r) => void attempt(() => look(r))}
                        restore={(r) => void attempt(() => restore(r))}
                        save={() => void attempt(saveEdits)}
                        discard={() => void attempt(discardEdits)}
                      />
                    ) : (
                      <Studio
                        runs={runs}
                        loaded={runsOf === work.id}
                        work={work}
                        restore={(r) => void attempt(() => restore(r))}
                        versionOf={(r) => versionOf(versions, r)?.number}
                        resume={() =>
                          void attempt(() =>
                            send(t.now.resumeMessage, run?.sceneId ?? sceneId, ""),
                          )
                        }
                        openTrace={(id) => go("/traces/" + id)}
                      />
                    )}
                  </section>
                </div>
              </aside>
            </div>
          )}
          {error && page !== "work" && (
            <div className={cx("toast-error")} data-floating role="alert">
              <span>{error}</span>
              <button aria-label={t.close} onClick={() => E("")}>
                <X size={13} />
              </button>
            </div>
          )}
          {dragging && (
            <div className={cx("dropzone")}>
              <ImagePlus size={28} />
              <p>{t.composer.drop}</p>
            </div>
          )}
        </main>
        {picking && (
          <Dialog
            title={t.titles.library}
            heading={<Title name="library" size="section" />}
            wide
            onClose={() => setPicking(false)}
          >
            <Library use={use} action={t.work.addIt} />
          </Dialog>
        )}
        {choosing && (
          <Dialog
            title={choosing.kind === "picture" ? t.titles.choosePicture : t.titles.chooseDrawing}
            heading={
              <Title
                name={choosing.kind === "picture" ? "choosePicture" : "chooseDrawing"}
                size="section"
              />
            }
            wide
            onClose={() => setChoosing(undefined)}
          >
            <Library
              kinds={[choosing.kind]}
              action={choosing.kind === "picture" ? t.edit.usePicture : t.edit.useDrawing}
              use={(m) => {
                setChoosing(undefined);
                if (m.kind === choosing.kind)
                  void attempt(async () => choosing.chosen(m));
              }}
            />
          </Dialog>
        )}
        <Presence show={!!trash}>
          <UndoToast text={t.work.deleted(trash?.title ?? "")} onUndo={keep} />
        </Presence>
      </div>
      </ChooseLocale.Provider>
      </AccountContext.Provider>
    </LocaleContext.Provider>
  );
}

/** The panel's left edge, dragged to share the page between the canvas and the panel; the
 * width is remembered for next time. Arrow keys move it too. */
function Resizer({
  kind,
  width,
  set,
  label,
}: {
  kind: Sized;
  width: number;
  set: (kind: Sized, n: number) => void;
  label: string;
}) {
  const clamp = (n: number) => panelWidth.clamp(kind, n);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={cx("resizer")}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        const start = e.clientX,
          from = width;
        let last = from;
        setDragging(true);
        const move = (m: PointerEvent) => {
          last = clamp(from + start - m.clientX);
          set(kind, last);
        };
        const up = () => {
          setDragging(false);
          panelWidth.save(kind, last);
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
      }}
      onDoubleClick={() => {
        set(kind, panelWidths[kind].initial);
        panelWidth.save(kind, panelWidths[kind].initial);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 20;
        const next =
          e.key === "ArrowLeft"
            ? width + step
            : e.key === "ArrowRight"
              ? width - step
              : undefined;
        if (next === undefined) return;
        e.preventDefault();
        set(kind, clamp(next));
        panelWidth.save(kind, clamp(next));
      }}
    />
  );
}
