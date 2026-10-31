import { SceneView, DetailView } from "./SceneView.tsx";
import { Activity, Now, live } from "./Activity.tsx";
import { OrbitSketch } from "../../../modules/ui/brand/orbit.tsx";
import { useEffect, useRef, useState } from "react";
import {
  Undo2,
  ChevronDown,
  X,
  History,
  MessagesSquare,
  PanelRightClose,
  ImagePlus,
} from "lucide-react";
import { Lantern } from "@drawy/ui/brand";
import { ModelSketch, KinshipSketch } from "@drawy/ui/sketches";
import {
  Spinner,
  LocaleContext,
  Tooltips,
  Presence,
  UndoToast,
  Dialog,
  type Locale,
} from "@drawy/ui";
import { api, type Summary, type User } from "./api.ts";
import { cx } from "./cx.ts";
import { Versions } from "./Versions.tsx";
import { Rail, Rename } from "./Rail.tsx";
import { Auth } from "./Auth.tsx";
import { Composer, type Attachment } from "./Composer.tsx";
import { Library } from "./Library.tsx";
import { Settings } from "./Settings.tsx";
import type {
  Work,
  Run,
  Selection,
  Target,
} from "../../../modules/contracts/index.ts";
import type { Material, StyleMaterial } from "@drawy/materials/schema";
import { TraceView } from "./TraceView.tsx";
import { Title } from "./Title.tsx";
import { ChooseLocale, dictionaries, useLanguage } from "./i18n.tsx";
const sketches = [OrbitSketch, ModelSketch, KinshipSketch];
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
const workIdOf = (path: string) => path.match(/^\/a\/([^/]+)/)?.[1];
/** What the panel beside the canvas shows. */
type Panel = "" | "journal" | "history";
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
    [works, L] = useState<Summary[]>([]),
    [work, W] = useState<Work>(),
    [sceneId, P] = useState("root"),
    [runs, R] = useState<Run[]>([]),
    [prompt, Q] = useState(""),
    [attachments, A] = useState<Attachment[]>([]),
    [uploading, setUploading] = useState(0),
    [style, setStyle] = useState<StyleMaterial>(),
    [selected, S] = useState<Selection>(),
    [detailId, setDetail] = useState<string>(),
    [panel, setPanel] = useState<Panel>(""),
    [picking, setPicking] = useState(false),
    [scenes, M] = useState(false),
    [dismissed, setDismissed] = useState(""),
    [offline, G] = useState(false),
    [busy, B] = useState(false),
    [titling, setTitling] = useState(false),
    [dragging, setDragging] = useState(false),
    [trash, setTrash] = useState<Summary>(),
    // Options picked on the author's questions, sent with whatever the user writes.
    [choices, setChoices] = useState("");
  const page = pageOf(path);
  const journal = panel === "journal";
  const J = (on: boolean) => setPanel(on ? "journal" : "");
  const toggle = (p: Panel) => setPanel(panel === p ? "" : p);
  const conversation = useRef<HTMLElement>(null);
  const following = useRef(true);
  const current = useRef(work);
  current.current = work;
  const deleting = useRef<{ id: string; timer: ReturnType<typeof setTimeout> }>(
    undefined,
  );
  const run = runs.at(-1),
    working = live(run);
  const active = work?.scenes[sceneId];
  useEffect(() => {
    if (work && !work.scenes[sceneId]) {
      P(work.rootSceneId);
      S(undefined);
    }
    if (detailId && work && !work.details[detailId]) setDetail(undefined);
  }, [work, sceneId, detailId]);
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      E("");
      await fn();
    } catch (e) {
      E(e instanceof Error ? e.message : String(e));
    }
  };
  const go = (to: string) => {
    if (to !== location.pathname) history.pushState(null, "", to);
    setPath(to);
  };
  const refreshList = () => api<Summary[]>("/works").then(L);
  async function load(id: string) {
    const [w, r] = await Promise.all([
      api<Work>("/works/" + id),
      api<Run[]>("/works/" + id + "/runs"),
    ]);
    W(w);
    setDetail(undefined);
    P(w.rootSceneId);
    S(undefined);
    R(r);
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
    return () => removeEventListener("popstate", pop);
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
      S(undefined);
      setPanel("");
    }
  }, [path, user?.id]);
  useEffect(() => {
    if (!user) return;
    void attempt(refreshList);
    const events = new EventSource("/api/events");
    events.onmessage = (e) => {
      G(false);
      const event = JSON.parse(e.data);
      if (event.type === "connected") {
        void refreshList();
        if (current.current)
          void Promise.all([
            api<Work>("/works/" + current.current.id),
            api<Run[]>("/works/" + current.current.id + "/runs"),
          ]).then(([w, r]) => {
            W(w);
            R(r);
          });
        return;
      }
      if (event.type === "work" && event.work.id === current.current?.id) {
        W(event.work);
        void refreshList();
      }
      if (event.type === "run" && event.run.workId === current.current?.id) {
        R((old) => {
          const found = old.some((r) => r.id === event.run.id);
          return found
            ? old.map((r) => (r.id === event.run.id ? event.run : r))
            : [...old, event.run];
        });
        if (!live(event.run)) void refreshList();
      }
    };
    events.onerror = () => G(true);
    return () => events.close();
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
  async function send(text = prompt, target = sceneId, picked = choices) {
    if (!text.trim() || working || uploading) return;
    B(true);
    try {
      let w = work;
      const message =
        !w && style ? `${text.trim()}\n${t.home.styleLine(style.name[locale])}` : text;
      if (!w) {
        w = await api<Work>("/works", "POST", { title: text.trim().slice(0, 36) });
        W(w);
        P(w.rootSceneId);
        target = w.rootSceneId;
        go("/a/" + w.id);
      }
      const request = selected
        ? `${message}\nSelected module: ${selected.moduleId}\n${selected.label}`
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
      Q("");
      A([]);
      setStyle(undefined);
      setChoices("");
      await refreshList();
    } finally {
      B(false);
    }
  }
  async function enter(id: string, title?: string) {
    if (!work?.scenes[id]) {
      throw Error(t.work.noScene);
    }
    P(id);
    setDetail(undefined);
    S(undefined);
    M(false);
    if (!work.scenes[id].modules.length && !working)
      await send(t.work.expand(title || work.scenes[id].title), id);
  }
  async function restore(revision: number) {
    const w = await api<Work>("/works/" + work!.id + "/restore", "POST", {
      revision,
    });
    W(w);
    if (!w.scenes[sceneId]) P(w.rootSceneId);
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
      clearTimeout(pending.timer);
      void api("/works/" + pending.id, "DELETE").catch(() => {});
    }
    if (work?.id === w.id) go("/");
    setTrash(w);
    deleting.current = {
      id: w.id,
      timer: setTimeout(() => {
        deleting.current = undefined;
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
  const status = work &&
    (offline ||
      run?.status === "waiting" ||
      (!journal && (working || run?.id !== dismissed))) && (
      <Now
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
      />
    );
  const composer = (place: "home" | "dock") => (
    <Composer
      place={place}
      value={prompt}
      set={Q}
      attachments={attachments}
      detach={(id) => A((old) => old.filter((a) => a.id !== id))}
      uploading={uploading}
      quote={place === "dock" ? selected?.label : undefined}
      unquote={() => S(undefined)}
      placeholder={
        place === "home"
          ? t.home.placeholder
          : run?.status === "waiting"
            ? t.composer.answering
            : selected
              ? t.composer.selected
              : working
                ? t.composer.working
                : t.composer.continue
      }
      status={place === "dock" ? status : undefined}
      style={place === "home" ? style : undefined}
      setStyle={place === "home" ? setStyle : undefined}
      working={working}
      busy={busy}
      send={() => void attempt(() => send())}
      stop={() =>
        void attempt(() => api("/runs/" + run!.id + "/cancel", "POST"))
      }
      attach={(files) => void attempt(() => upload(files))}
      pick={() => setPicking(true)}
    />
  );
  const droppable = page === "home" || page === "work";
  return (
    <LocaleContext.Provider value={locale}>
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
            rename={(id, title) => void attempt(() => rename(id, title))}
            remove={remove}
            logout={() =>
              void attempt(async () => {
                await api("/auth/logout", "POST");
                L([]);
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
            <div className={cx("home")}>
              <section className={cx("hero")}>
                <h1 className={cx("hero-title")}>
                  <Lantern size={40} className={cx("hero-mark")} />
                  <Title name="hero" size="hero" />
                </h1>
                {composer("home")}
                <nav className={cx("examples")}>
                  {t.home.examples.map((text, i) => {
                    const Sketch = sketches[i];
                    return (
                      <button
                        className={cx("example")}
                        key={text}
                        style={{ animationDelay: 240 + i * 80 + "ms" }}
                        onClick={() => void attempt(() => send(text))}
                      >
                        <span className={cx("example-art")}>
                          <Sketch />
                        </span>
                        <span className={cx("example-text")}>{text}</span>
                      </button>
                    );
                  })}
                </nav>
              </section>
            </div>
          ) : !work ? (
            <div className={cx("loading")}>
              <Spinner />
            </div>
          ) : (
            <div className={cx("workspace")} data-panel={panel || undefined}>
              <section
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
                  work={work}
                  sceneId={sceneId}
                  run={working || run?.status === "waiting" ? run : undefined}
                  disabled={
                    !!run &&
                    ["running", "viewing", "waiting"].includes(run.status)
                  }
                  open={(target: Target) =>
                    target.kind === "scene"
                      ? void attempt(() => enter(target.id))
                      : setDetail(target.id)
                  }
                  select={(value) => {
                    S(value || undefined);
                  }}
                  commit={(moves) =>
                    void attempt(async () => {
                      if (working) throw Error(t.work.wait);
                      W(
                        await api("/works/" + work.id + "/modules", "PATCH", {
                          sceneId,
                          baseRevision: work.revision,
                          moves,
                        }),
                      );
                    })
                  }
                />
                <div className={cx("dock")}>
                  {error && (
                    <div className={cx("toast-error")} role="alert">
                      <span>{error}</span>
                      <button aria-label={t.close} onClick={() => E("")}>
                        <X size={13} />
                      </button>
                    </div>
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
                    disabled={working || work.revision < 2}
                    onClick={() => void attempt(() => restore(work.revision - 1))}
                  >
                    <Undo2 size={17} />
                  </button>
                  <button
                    aria-label={t.work.history}
                    data-tip={t.work.history}
                    aria-pressed={panel === "history"}
                    onClick={() => toggle("history")}
                  >
                    <History size={17} />
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
                </nav>
                <div className={cx("side-panel")} data-kind={panel || undefined} inert={!panel}>
                  <header>
                    <h2>
                      {panel === "history" ? (
                        <Title name="history" size="section" />
                      ) : (
                        <Title name="journal" size="section" />
                      )}
                    </h2>
                    <button
                      aria-label={t.collapse}
                      data-tip={t.collapse}
                      onClick={() => setPanel("")}
                    >
                      <PanelRightClose size={17} />
                    </button>
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
                    {panel === "history" ? (
                      <Versions
                        id={work.id}
                        current={work.revision}
                        restore={(r) => void attempt(() => restore(r))}
                      />
                    ) : (
                      <Activity
                        runs={runs}
                        work={work}
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
        <Presence show={!!trash}>
          <UndoToast text={t.work.deleted(trash?.title ?? "")} onUndo={keep} />
        </Presence>
      </div>
      </ChooseLocale.Provider>
    </LocaleContext.Provider>
  );
}
