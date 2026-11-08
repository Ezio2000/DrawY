import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { X, ImagePlus } from "lucide-react";
import {
  Spinner,
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
import { Composer, chosen } from "./Composer.tsx";
import { Library } from "./Library.tsx";
import { Settings, leaving } from "./Settings.tsx";
import { TraceView } from "./TraceView.tsx";
import { Title } from "./Title.tsx";
import { Home } from "./Home.tsx";
import { listen } from "./events.ts";
import { ChooseLocale, dictionaries, useLanguage } from "./i18n.tsx";
import { pageOf, sceneOf, workIdOf } from "./routes.ts";
import { useRequest } from "./session/request.ts";
import { live, useWorkSession, type Ask, type SessionHost } from "./session/work.ts";
import { deviceOf, type Device, type ShellProps } from "./shell.ts";
import { DesktopWorkPage } from "./desktop/WorkPage.tsx";

/** The work page for each device: the same session, laid out for the screen it is on. */
const shells: Record<Device, ComponentType<ShellProps>> = {
  desktop: DesktopWorkPage,
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
    // The drawing models to pick from; until the chosen one is connected, nothing can
    // be drawn.
    [models, setModels] = useState<Models>(),
    // Something that went well, said briefly.
    [notice, setNotice] = useState(""),
    [picking, setPicking] = useState(false),
    [offline, G] = useState(false),
    // A request from the home page on its way, making the work it is for.
    [starting, setStarting] = useState(false),
    [dragging, setDragging] = useState(false),
    [trash, setTrash] = useState<Summary>();
  const page = pageOf(path);
  const deleting = useRef<{ id: string; timer: ReturnType<typeof setTimeout> }>(undefined);
  const language = useRef({ t, locale });
  language.current = { t, locale };
  const [request, draft] = useRequest(() => language.current);

  const go = (to: string) => {
    if (to === location.pathname) return;
    if (!leaving()) return;
    window.history.pushState(null, "", to);
    setPath(to);
  };
  const refreshList = () =>
    api<Summary[]>("/works").then((w) => {
      L(w);
      setListed(true);
    });
  // What the open work needs from the app; the calls go to what the app is now.
  const now = useRef({ go, refreshList, user });
  now.current = { go, refreshList, user };
  const [host] = useState<SessionHost>(() => ({
    words: () => language.current.t,
    locale: () => language.current.locale,
    go: (to, how) => {
      if (how === "push") return now.current.go(to);
      window.history.replaceState(null, "", to);
      setPath(to);
    },
    listed: () => now.current.refreshList(),
    spent: () => U((u) => (u && u.quota !== null ? { ...u, quota: Math.max(0, u.quota - 1) } : u)),
    notice: setNotice,
    fail: (e) => E(messageOf(e)),
    listen: (event) => {
      const u = now.current.user;
      return u ? listen(u.id, { event }) : () => {};
    },
  }));
  const { session, store, begin } = useWorkSession(user ? workIdOf(path) : undefined, host);
  // The session follows the scene the address names before the page is painted.
  useLayoutEffect(() => store?.locate(sceneOf(path)), [store, path]);

  const manages = !!user?.permissions.includes("models.manage");
  const connected =
    models && !!models.labels.find((m) => m.id === models.chosen.label)?.ready;

  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      E("");
      await fn();
    } catch (e) {
      E(messageOf(e));
    }
  };
  /** Whether a request can go: a drawing model connected and requests left; answering the
   * author's questions still works when none are left. */
  const allowed = (answering: boolean) => {
    if (user?.quota === 0 && !answering) throw Error(t.composer.quotaOut);
    if (connected) return true;
    if (manages) go("/settings");
    return false;
  };
  /** Sends the request as written, or what is given in its place, to the open work. */
  const send = async (ask: Partial<Ask> = {}) => {
    const r = draft.get();
    const text = ask.text ?? r.text,
      materials = ask.materials ?? r.attachments.map((a) => a.id);
    if (!store || r.uploading || (!text.trim() && !materials.length)) return;
    if (!allowed(store.get().waiting)) return;
    await store.send({
      text,
      materials,
      picked: ask.picked ?? r.choices,
      scene: ask.scene,
      sent: ask.sent ?? draft.clear,
    });
  };
  /** A request from the home page: it makes a work for itself, opens it and is sent there. */
  async function start(text = draft.get().text) {
    const r = draft.get();
    if ((!text.trim() && !r.attachments.length) || r.uploading || starting) return;
    if (!allowed(false)) return;
    setStarting(true);
    try {
      const w = await api<Work>("/works", "POST", {
        title: (text.trim() || r.attachments[0].name).slice(0, 36),
      });
      const made = begin(w);
      go("/a/" + w.id);
      await made.send({
        text: r.style ? `${text.trim()}\n${t.home.styleLine(r.style.name[locale])}` : text,
        materials: r.attachments.map((a) => a.id),
        picked: r.choices,
        scene: w.rootSceneId,
        sent: draft.clear,
      });
    } finally {
      setStarting(false);
    }
  }
  /** A blank canvas, made and opened: from the side bar and from the home page. */
  const createBlank = () =>
    void attempt(async () => {
      const w = await api<Work>("/works", "POST", { title: t.rail.untitled });
      begin(w);
      go("/a/" + w.id);
      await refreshList();
    });
  const choose = (change: SettingsChange) => {
    setModels((m) => m && chosen(m, change));
    // What the server settles on (a label taken away falls back) is shown next.
    void attempt(async () => {
      await api("/settings", "PUT", change);
      setModels(await api<Models>("/models"));
    });
  };

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
      offline: G,
    });
  }, [user?.id]);
  useEffect(() => {
    if (!user || (page !== "home" && page !== "work")) return;
    void api<Models>("/models").then(setModels, () => {});
  }, [user?.id, page]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 2400);
    return () => clearTimeout(t);
  }, [notice]);
  // An error says its piece and goes.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => E(""), 8000);
    return () => clearTimeout(t);
  }, [error]);
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
  const Shell = shells[deviceOf()];
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
                current={session?.id}
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
                  start={(text) => void attempt(() => start(text))}
                  blank={createBlank}
                  listed={listed}
                  all={() => O(true)}
                  open={(id) => go("/a/" + id)}
                  composer={
                    <Composer
                      place="home"
                      value={request.text}
                      set={draft.write}
                      attachments={request.attachments}
                      detach={draft.detach}
                      uploading={request.uploading}
                      unquote={() => {}}
                      placeholder={t.home.placeholder}
                      status={
                        connected === false && (
                          <div className={cx("now")} data-tone="failed">
                            <span className={cx("now-line")}>
                              {manages ? t.composer.unconnected : t.composer.unconnectedMember}
                            </span>
                            {manages && (
                              <button
                                className={cx("primary small")}
                                onClick={() => go("/settings")}
                              >
                                {t.composer.connect}
                              </button>
                            )}
                          </div>
                        )
                      }
                      style={request.style}
                      setStyle={draft.setStyle}
                      working={false}
                      busy={starting}
                      send={() => void attempt(() => start())}
                      stop={() => {}}
                      attach={(files) => void attempt(() => draft.upload(files))}
                      pick={() => setPicking(true)}
                      models={models}
                      quota={user.quota}
                      spent={user.quota === 0}
                      choose={choose}
                    />
                  }
                />
              ) : !session?.work ? (
                <div className={cx("loading")}>
                  <Spinner />
                </div>
              ) : (
                <Shell
                  session={session}
                  request={request}
                  draft={draft}
                  app={{
                    user,
                    models,
                    choose,
                    offline,
                    error,
                    clearError: () => E(""),
                    fail: (e) => E(messageOf(e)),
                    notice,
                    say: setNotice,
                    attempt,
                    go,
                    library: () => setPicking(true),
                    send,
                  }}
                />
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
      </AccountContext.Provider>
    </LocaleContext.Provider>
  );
}
