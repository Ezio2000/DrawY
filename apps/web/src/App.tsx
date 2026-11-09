import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, ImagePlus } from "lucide-react";
import {
  Spinner,
  useLocale,
  LocaleContext,
  Tooltips,
  Presence,
  UndoToast,
  Dialog,
} from "@drawy/ui";
import type { Material } from "@drawy/materials/schema";
import type { SettingsChange, Work } from "../../../modules/contracts/index.ts";
import { api, type Models, type Summary, type User } from "./api.ts";
import { AccountContext } from "./account.tsx";
import { cx } from "./cx.ts";
import { Rail } from "./Rail.tsx";
import { Auth } from "./Auth.tsx";
import { Composer, Unconnected, chosen } from "./Composer.tsx";
import { Library } from "./Library.tsx";
import { Settings, leaving } from "./Settings.tsx";
import { TraceView } from "./TraceView.tsx";
import { Title } from "./Title.tsx";
import { Home } from "./Home.tsx";
import { listen } from "./events.ts";
import { ChooseLocale, dictionaries, useLanguage } from "./i18n.tsx";
import { pageOf, sceneOf, workIdOf } from "./routes.ts";
import { useRequest, type RequestDraft } from "./session/request.ts";
import { useSelect } from "./session/store.ts";
import {
  live,
  useWorkSession,
  type Ask,
  type SessionHost,
  type WorkSession,
} from "./session/work.ts";
import { Feedback } from "./feedback.ts";
import type { Asking } from "./shell.ts";
import type { ComponentType } from "react";
import type { ShellProps } from "./shell.ts";
import { useShell } from "./shells.ts";
import { browserStorage } from "./storage.ts";
import { followViewport } from "./viewport.ts";

export function App() {
  const [locale, setLocale] = useLanguage();
  const t = dictionaries[locale];
  const [user, U] = useState<User | null | undefined>(),
    [path, setPath] = useState(location.pathname),
    [open, O] = useState(false),
    // Whether the list of works has arrived, so the home page does not say there are none
    // before it knows.
    [listed, setListed] = useState(false),
    [works, L] = useState<Summary[]>([]),
    // The labels to draw with; until the chosen one is connected, nothing can be drawn.
    [models, setModels] = useState<Models>(),
    [picking, setPicking] = useState(false),
    // A request from the home page on its way, making the work it is for.
    [starting, setStarting] = useState(false),
    [dragging, setDragging] = useState(false),
    [trash, setTrash] = useState<Summary>();
  const page = pageOf(path);
  const shells = useShell(browserStorage);
  const deleting = useRef<{ id: string; timer: ReturnType<typeof setTimeout> }>(undefined);
  const language = useRef({ t, locale });
  language.current = { t, locale };
  const draft = useRequest();
  const [feedback] = useState(() => new Feedback(() => language.current.t));
  const { attempt } = feedback;

  const [go] = useState(() => (to: string) => {
    if (to === location.pathname) return;
    if (!leaving()) return;
    window.history.pushState(null, "", to);
    setPath(to);
  });
  const refreshList = () =>
    api<Summary[]>("/works").then((w) => {
      L(w);
      setListed(true);
    });
  // What the open work needs from the app; the calls go to what the app is now.
  const now = useRef({ go, refreshList, user });
  now.current = { go, refreshList, user };
  const [host] = useState<SessionHost>(() => ({
    locale: () => language.current.locale,
    go: (to, how) => {
      if (how === "push") return now.current.go(to);
      window.history.replaceState(null, "", to);
      setPath(to);
    },
    listed: () => now.current.refreshList(),
    spent: () => U((u) => (u && u.quota !== null ? { ...u, quota: Math.max(0, u.quota - 1) } : u)),
    listen: (listener) => {
      const u = now.current.user;
      return u ? listen(u.id, listener) : () => {};
    },
  }));
  const { session, begin } = useWorkSession(user ? workIdOf(path) : undefined, host);
  // The session follows the scene the address names before the page is painted.
  useLayoutEffect(() => session?.locate(sceneOf(path)), [session, path]);

  const manages = !!user?.permissions.includes("models.manage");
  const blocked: Asking["blocked"] =
    models && !models.labels.find((m) => m.id === models.chosen.label)?.ready
      ? "unconnected"
      : user?.quota === 0
        ? "spent"
        : undefined;

  /** Whether a request can go: a drawing model connected and requests left; answering the
   * author's questions still works when none are left. Those who manage the models are
   * taken to connect one. */
  const allowed = (answering: boolean) => {
    if (blocked === "spent" && !answering) throw Error(t.composer.quotaOut);
    if (blocked !== "unconnected") return true;
    if (manages) go("/settings");
    return false;
  };
  /** Sends the request as written, or what is given in its place: to the open work, or,
   * from the home page, to a work it makes for itself and opens. */
  const send = async (ask: Partial<Ask> = {}) => {
    const r = draft.get();
    const text = ask.text ?? r.text,
      materials = ask.materials ?? r.attachments.map((a) => a.id);
    if (r.uploading || (!text.trim() && !materials.length)) return;
    if (session) {
      if (!allowed(session.get().waiting)) return;
      return session.send({ text, materials, picked: ask.picked ?? r.choices, scene: ask.scene, focus: ask.focus, sent: ask.sent ?? draft.clear });
    }
    if (starting || !allowed(false)) return;
    setStarting(true);
    try {
      const w = await api<Work>("/works", "POST", {
        title: (text.trim() || r.attachments[0].name[locale]).slice(0, 36),
      });
      const made = begin(w);
      go("/a/" + w.id);
      await made.send({
        text: r.style ? `${text.trim()}\n${t.home.styleLine(r.style.name[locale])}` : text,
        materials,
        picked: r.choices,
        scene: w.rootSceneId,
        sent: draft.clear,
      });
    } finally {
      setStarting(false);
    }
  };
  const choose = (change: SettingsChange) => {
    setModels((m) => m && chosen(m, change));
    // What the server settles on (a label taken away falls back) is shown next.
    void attempt(async () => {
      await api("/settings", "PUT", change);
      setModels(await api<Models>("/models"));
    });
  };
  // What the work page is handed keeps its identity until the labels or what blocks a
  // request change; its functions call through to the app as it is now.
  const latest = useRef({ send, choose });
  latest.current = { send, choose };
  const asking = useMemo<Asking>(
    () => ({
      draft,
      send: (ask) => latest.current.send(ask),
      pick: () => setPicking(true),
      models,
      choose: (change) => latest.current.choose(change),
      blocked,
    }),
    [models, blocked],
  );
  /** A blank canvas, made and opened: from the side bar and from the home page. */
  const createBlank = () =>
    void attempt(async () => {
      const w = await api<Work>("/works", "POST", { title: t.rail.untitled });
      begin(w);
      go("/a/" + w.id);
      await refreshList();
    });

  useEffect(followViewport, []);
  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => U(r.ok ? await r.json() : null))
      .catch(feedback.fail);
    const pop = () => setPath(location.pathname);
    addEventListener("popstate", pop);
    // A deletion waiting to be taken back happens now if the page is closed.
    const flush = () => {
      const pending = deleting.current;
      if (pending)
        void fetch("/api/works/" + pending.id, { method: "DELETE", keepalive: true });
    };
    addEventListener("pagehide", flush);
    return () => {
      removeEventListener("popstate", pop);
      removeEventListener("pagehide", flush);
    };
  }, []);
  // The list of works follows the server: a work saved anew, a run starting or ending.
  useEffect(() => {
    if (!user) return;
    void attempt(refreshList);
    return listen(user.id, {
      event: (event) => {
        if (event.type === "connected" || event.type === "work") void refreshList();
        if (event.type !== "run") return;
        const run = event.run;
        L((list) =>
          list.map((w) =>
            w.id === run.workId && w.progress.run !== run.status
              ? { ...w, progress: { ...w.progress, run: run.status } }
              : w,
          ),
        );
        if (!live(run)) void refreshList();
      },
    });
  }, [user?.id]);
  useEffect(() => {
    if (!user || (page !== "home" && page !== "work")) return;
    void api<Models>("/models").then(setModels, () => {});
  }, [user?.id, page]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && O(false);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open]);

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
    if (workIdOf(path) === w.id) go("/");
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
    draft.use(m);
    setPicking(false);
    if (page !== "work" && page !== "home") go("/");
  }
  const shownWorks = works.filter((w) => w.id !== trash?.id);
  const droppable = page === "home" || page === "work";
  const loading = (
    <div className={cx("loading")}>
      <Spinner />
    </div>
  );
  return (
    <LocaleContext.Provider value={locale}>
      <AccountContext.Provider value={user ?? null}>
        <ChooseLocale.Provider value={setLocale}>
          <Tooltips />
          <div
            className={cx("app")}
            data-whole={(page === "work" && !!session && shells.whole) || undefined}
          >
            {user && (
              <Rail
                user={user}
                open={open}
                setOpen={O}
                page={page}
                works={shownWorks}
                current={session?.id}
                go={go}
                create={createBlank}
                remove={remove}
                shells={shells}
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
                if (droppable && e.dataTransfer.types.includes("Files")) setDragging(true);
              }}
              onDragOver={(e) => droppable && e.preventDefault()}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
              }}
              onDrop={(e) => {
                if (!droppable) return;
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files.length)
                  void attempt(() => draft.upload(e.dataTransfer.files));
              }}
            >
              {user === undefined ? (
                loading
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
                  start={(text) => void attempt(() => send({ text }))}
                  blank={createBlank}
                  listed={listed}
                  all={() => O(true)}
                  open={(id) => go("/a/" + id)}
                  composer={
                    <HomeComposer
                      draft={draft}
                      asking={asking}
                      starting={starting}
                      quota={user.quota}
                      go={go}
                      feedback={feedback}
                      send={() => void attempt(() => send())}
                    />
                  }
                />
              ) : !session ? (
                loading
              ) : (
                <OpenWork
                  session={session}
                  Page={shells.Page}
                  asking={asking}
                  feedback={feedback}
                  go={go}
                  loading={loading}
                />
              )}
              <FloatingError feedback={feedback} shown={page !== "work" || !session} />
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
      </AccountContext.Provider>
    </LocaleContext.Provider>
  );
}

/** The open work's page once the work has arrived, or why it could not be opened. */
function OpenWork({
  session,
  Page,
  loading,
  ...props
}: ShellProps & { Page: ComponentType<ShellProps>; loading: React.ReactNode }) {
  const { here, unopened } = useSelect(session, (s) => ({ here: !!s.work, unopened: s.unopened }));
  useEffect(() => {
    if (unopened) props.feedback.fail(unopened);
  }, [unopened]);
  if (!here) return unopened ? null : loading;
  return (
    <Suspense fallback={loading}>
      <Page session={session} {...props} />
    </Suspense>
  );
}

/** What went wrong, over pages that have no place of their own to say it. */
function FloatingError({ feedback, shown }: { feedback: Feedback; shown: boolean }) {
  const t = dictionaries[useLocale()];
  const error = useSelect(feedback, (f) => f.error);
  if (!error || !shown) return null;
  return (
    <div className={cx("toast-error")} data-floating role="alert">
      <span>{error}</span>
      <button aria-label={t.close} onClick={feedback.dismiss}>
        <X size={13} />
      </button>
    </div>
  );
}

/** The home page's composer: it reads the request itself, so typing draws only it. */
function HomeComposer({
  draft,
  asking,
  starting,
  quota,
  go,
  send,
  feedback,
}: {
  feedback: Feedback;
  draft: RequestDraft;
  asking: Asking;
  starting: boolean;
  quota: number | null;
  go: (path: string) => void;
  send: () => void;
}) {
  const t = dictionaries[useLocale()];
  const request = useSelect(draft, (r) => r);
  return (
    <Composer
      place="home"
      value={request.text}
      set={draft.write}
      attachments={request.attachments}
      detach={draft.detach}
      uploading={request.uploading}
      unquote={() => {}}
      placeholder={t.home.placeholder}
      status={asking.blocked === "unconnected" && <Unconnected go={go} />}
      style={request.style}
      setStyle={draft.setStyle}
      working={false}
      busy={starting}
      send={send}
      stop={() => {}}
      attach={(files) => void feedback.attempt(() => draft.upload(files))}
      pick={asking.pick}
      models={asking.models}
      quota={quota}
      spent={asking.blocked === "spent"}
      choose={asking.choose}
    />
  );
}
