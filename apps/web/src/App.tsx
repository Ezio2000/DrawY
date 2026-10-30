import { SceneView, DetailView } from "./SceneView.tsx";
import { Activity, Now, live } from "./Activity.tsx";
import { OrbitSketch } from "../../../modules/ui/brand/orbit.tsx";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Paperclip,
  Plus,
  Settings2,
  LogOut,
  History,
  Images,
  Undo2,
  Square,
  ChevronDown,
  Trash2,
  X,
  PanelRight,
  ScrollText,
} from "lucide-react";
import { Lantern, PanelMark } from "@drawy/ui/brand";
import { ModelSketch, KinshipSketch } from "@drawy/ui/sketches";
import { Spinner, LocaleContext, Tooltips } from "@drawy/ui";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { SettingsDialog, MaterialsDialog, HistoryDialog } from "./Dialogs.tsx";
import type {
  Work,
  Run,
  Selection,
  Target,
} from "../../../modules/contracts/index.ts";
import type { Material } from "@drawy/materials/schema";
import { TraceView } from "./TraceView.tsx";
type Attachment = { id: string; url: string; name: string };
const examples = [
  "太阳系是如何运转的？",
  "大语言模型是怎么工作的？",
  "红楼梦中的人物关系",
];
const sketches = [OrbitSketch, ModelSketch, KinshipSketch];
export function App() {
  const [user, U] = useState<{ id: string; name: string } | null | undefined>(),
    [error, E] = useState(""),
    [open, O] = useState(false),
    [works, L] = useState<Work[]>([]),
    [work, W] = useState<Work>(),
    [sceneId, P] = useState("root"),
    [runs, R] = useState<Run[]>([]),
    [dialog, D] = useState(""),
    [prompt, Q] = useState(""),
    [assets, A] = useState<Attachment[]>([]),
    [tracing, T] = useState(location.pathname.startsWith("/traces")),
    [selected, S] = useState<Selection>(),
    [detailId, setDetail] = useState<string>(),
    [journal, J] = useState(false),
    [scenes, M] = useState(false),
    [dismissed, setDismissed] = useState(""),
    [offline, G] = useState(false),
    [busy, B] = useState(false),
    [query, F] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const following = useRef(true);
  const current = useRef(work);
  current.current = work;
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
  const refreshList = () => api("/works").then(L);
  async function load(id: string) {
    const w = await api<Work>("/works/" + id);
    W(w);
    setDetail(undefined);
    P(w.rootSceneId);
    S(undefined);
    const r = await api<Run[]>("/works/" + id + "/runs");
    R(r);
    // A reply from an earlier visit stays in the journal, not under the canvas.
    setDismissed(r.at(-1)?.id || "");
    history.pushState(null, "", "/a/" + id);
    O(false);
  }
  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => U(r.ok ? await r.json() : null))
      .catch((e) => E(e.message));
  }, []);
  useEffect(() => {
    if (!user) return;
    void attempt(async () => {
      await refreshList();
      const id = location.pathname.match(/^\/a\/([^/]+)/)?.[1];
      if (id) await load(id);
    });
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
    const pop = () => {
      T(location.pathname.startsWith("/traces"));
      const id = location.pathname.match(/^\/a\/([^/]+)/)?.[1];
      if (id) void attempt(() => load(id));
      else home(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function home(push = true) {
    W(undefined);
    setDetail(undefined);
    R([]);
    S(undefined);
    Q("");
    A([]);
    J(false);
    if (push) history.pushState(null, "", "/");
  }
  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const data = new FormData();
      data.append("file", file);
      const m = await api<Material>("/materials", "POST", data);
      if (m.kind === "picture")
        A((old) => [...old, { id: m.id, url: m.file.url, name: m.name.zh }]);
    }
  }
  async function send(text = prompt, target = sceneId) {
    if (!text.trim() || working) return;
    B(true);
    try {
      let w = work;
      if (!w) {
        w = await api<Work>("/works", "POST", { title: text.slice(0, 36) });
        W(w);
        P(w.rootSceneId);
        target = w.rootSceneId;
        history.pushState(null, "", "/a/" + w.id);
      }
      const request = selected
        ? `${text}\nSelected module: ${selected.moduleId}\n${selected.label}`
        : text;
      const r =
        run?.status === "waiting"
          ? await api<Run>("/runs/" + run.id + "/answer", "POST", {
              answer: request,
              materials: assets.map((a) => a.id),
            })
          : await api<Run>("/works/" + w.id + "/runs", "POST", {
              prompt: request,
              sceneId: target,
              materials: assets.map((a) => a.id),
            });
      R((old) =>
        old.some((x) => x.id === r.id)
          ? old.map((x) => (x.id === r.id ? r : x))
          : [...old, r],
      );
      Q("");
      A([]);
      await refreshList();
    } finally {
      B(false);
    }
  }
  async function enter(id: string, title?: string) {
    if (!work?.scenes[id]) {
      throw Error("这个入口还没有子场景，请让 AI 补充");
    }
    P(id);
    setDetail(undefined);
    S(undefined);
    M(false);
    if (!work.scenes[id].modules.length && !working)
      await send(
        `展开“${title || work.scenes[id].title}”场景，保持作品风格。`,
        id,
      );
  }
  async function restore(revision: number) {
    const w = await api<Work>("/works/" + work!.id + "/restore", "POST", {
      revision,
    });
    W(w);
    if (!w.scenes[sceneId]) P(w.rootSceneId);
    D("");
  }
  const crumbs = [];
  let at = active;
  while (at) {
    crumbs.unshift(at);
    at = at.parentId ? work?.scenes[at.parentId] : undefined;
  }
  const composer = (homePage: boolean) => (
    <div
      className={cx("composer")}
      data-place={homePage ? "home" : "dock"}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void attempt(() => upload(e.dataTransfer.files));
      }}
    >
      {((selected && !homePage) || !!assets.length) && (
        <div className={cx("composer-extras")}>
          {selected && !homePage && (
            <span className={cx("quote")}>
              <span>{selected.label.slice(0, 80)}</span>
              <button onClick={() => S(undefined)} aria-label="清除选择">
                <X size={12} />
              </button>
            </span>
          )}
          {assets.map((a) => (
            <span className={cx("attached")} key={a.id}>
              <img src={a.url} />
              <button
                aria-label="移除"
                onClick={() => A((old) => old.filter((x) => x.id !== a.id))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={cx("composer-field")}>
        <textarea
          aria-label="描述你想绘制的内容"
          placeholder={
            homePage
              ? "想探索什么？"
              : run?.status === "waiting"
                ? "回答问题…"
                : selected
                  ? "如何修改选中的部分？"
                  : working
                    ? "正在创作…"
                    : "继续探索，或修改这幅作品"
          }
          value={prompt}
          rows={1}
          onChange={(e) => Q(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              void attempt(() => upload(e.clipboardData.files));
            }
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void attempt(() => send());
            }
          }}
        />
        <div className={cx("composer-tools")}>
          <button
            className={cx("composer-attach")}
            aria-label="上传参考图"
            data-tip="参考图"
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={17} />
          </button>
          {working ? (
            <button
              className={cx("composer-stop")}
              aria-label="停止"
              data-tip="停止"
              onClick={() =>
                void attempt(() => api("/runs/" + run!.id + "/cancel", "POST"))
              }
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              className={cx("composer-send")}
              aria-label="发送"
              disabled={busy || !prompt.trim()}
              onClick={() => void attempt(() => send())}
            >
              {busy ? <Spinner size={15} /> : <ArrowUp size={18} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return (
    <LocaleContext.Provider value="zh">
      <Tooltips />
      <div className={cx("app")}>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void attempt(() => upload(e.target.files!));
            e.target.value = "";
          }}
        />
        {user && (
          <nav className={cx("rail")} data-open={open} aria-label="导航">
            <div className={cx("rail-head")}>
              <button
                className={cx("rail-button")}
                aria-label="展开侧栏"
                onClick={() => O(!open)}
              >
                <PanelMark size={22} open={open} />
              </button>
              <span className={cx("rail-brand")}>DrawY</span>
            </div>
            <button
              className={cx("rail-button rail-new")}
              aria-label="新探索"
              onClick={() => {
                home();
                O(false);
              }}
            >
              <span className={cx("rail-plus")}>
                <Plus size={15} />
              </span>
              <span className={cx("rail-label")}>新探索</span>
            </button>
            <section className={cx("rail-recents")} inert={!open}>
              <h2>最近</h2>
              {works.length > 8 && (
                <input
                  className={cx("search")}
                  value={query}
                  onChange={(e) => F(e.target.value)}
                  placeholder="搜索作品"
                />
              )}
              <ul>
                {works
                  .filter((w) => w.title.includes(query))
                  .map((w) => (
                    <li
                      className={cx("rail-work")}
                      data-current={w.id === work?.id || undefined}
                      key={w.id}
                    >
                      <button
                        className={cx("rail-work-open")}
                        onClick={() => void attempt(() => load(w.id))}
                      >
                        <span>{w.title}</span>
                      </button>
                      <button
                        className={cx("rail-work-delete")}
                        aria-label={"删除 " + w.title}
                        onClick={() =>
                          void attempt(async () => {
                            await api("/works/" + w.id, "DELETE");
                            if (work?.id === w.id) home();
                            await refreshList();
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
            <div className={cx("rail-foot")}>
              <button
                className={cx("rail-button")}
                aria-label="运行记录"
                onClick={() => {
                  history.pushState(null, "", "/traces");
                  T(true);
                  O(false);
                }}
              >
                <ScrollText size={17} />
                <span className={cx("rail-label")}>运行记录</span>
              </button>
              <button
                className={cx("rail-button")}
                aria-label="模型设置"
                onClick={() => D("settings")}
              >
                <Settings2 size={18} />
                <span className={cx("rail-label")}>设置</span>
              </button>
              <button
                className={cx("rail-button")}
                aria-label="退出登录"
                onClick={() =>
                  void attempt(async () => {
                    await api("/auth/logout", "POST");
                    home();
                    L([]);
                    U(null);
                    D("");
                    O(false);
                  })
                }
              >
                <LogOut size={17} />
                <span className={cx("rail-label")}>{user.name}</span>
              </button>
            </div>
          </nav>
        )}
        {open && <div className={cx("rail-scrim")} onClick={() => O(false)} />}
        <main className={cx("app-main")} data-bare={!user || undefined}>
          {user === undefined ? (
            <div className={cx("loading")}>
              <Spinner />
            </div>
          ) : !user ? (
            <Auth done={U} />
          ) : tracing ? (
            <TraceView
              close={() => {
                history.pushState(null, "", work ? "/a/" + work.id : "/");
                T(false);
              }}
            />
          ) : !work ? (
            <div className={cx("home")}>
              <section className={cx("hero")}>
                <h1 className={cx("hero-title")}>
                  <Lantern size={40} className={cx("hero-mark")} />
                  <span>
                    每个想法，都值得
                    <em>
                      探索
                      <svg viewBox="0 0 120 14" aria-hidden>
                        <path d="M3 9.5C22 5.6 47 4.2 70 5.1c16 .6 31 2 46 4.3" />
                      </svg>
                    </em>
                  </span>
                </h1>
                {composer(true)}
                <nav className={cx("examples")}>
                  {examples.map((text, i) => {
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
          ) : (
            <div
              className={cx("workspace")}
              data-journal={journal || undefined}
            >
              <section
                className={cx("stage")}
                data-working={working || undefined}
              >
                <header className={cx("topbar")}>
                  <nav className={cx("crumbs")}>
                    {crumbs.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && <i>/</i>}
                        <button
                          aria-current={p.id === sceneId || undefined}
                          onClick={() => void attempt(() => enter(p.id))}
                        >
                          {p.title}
                        </button>
                      </span>
                    ))}
                    {Object.keys(work.scenes).length > 1 && (
                      <span className={cx("scene-menu")} data-scene-menu>
                        <button
                          aria-label="全部场景"
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
                                {p.title}
                              </button>
                            ))}
                          </span>
                        )}
                      </span>
                    )}
                  </nav>
                  <div className={cx("actions")}>
                    <button
                      aria-label="撤销"
                      data-tip="撤销"
                      disabled={working || work.revision < 2}
                      onClick={() =>
                        void attempt(() => restore(work.revision - 1))
                      }
                    >
                      <Undo2 size={17} />
                    </button>
                    <button
                      aria-label="版本"
                      data-tip="版本"
                      onClick={() => D("history")}
                    >
                      <History size={17} />
                    </button>
                    <button
                      aria-label="素材"
                      data-tip="素材"
                      onClick={() => D("materials")}
                    >
                      <Images size={17} />
                    </button>
                    <button
                      aria-label="创作过程"
                      data-tip="创作过程"
                      aria-pressed={journal}
                      data-live={working || undefined}
                      onClick={() => J(!journal)}
                    >
                      <PanelRight size={17} />
                    </button>
                  </div>
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
                      if (working) throw Error("请等待当前绘制完成");
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
                      <button aria-label="关闭" onClick={() => E("")}>
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  {(offline ||
                    run?.status === "waiting" ||
                    (!journal && (working || run?.id !== dismissed))) && (
                    <Now
                      run={run}
                      work={work}
                      offline={offline}
                      pictures={!!active?.modules.length}
                      answer={(o) => void attempt(() => send(o))}
                      reveal={() => J(true)}
                      dismiss={() => setDismissed(run?.id || "")}
                    />
                  )}
                  {composer(false)}
                </div>
                {detailId && work.details[detailId] && (
                  <DetailView
                    detail={work.details[detailId]}
                    close={() => setDetail(undefined)}
                  />
                )}
              </section>
              <aside className={cx("journal")} inert={!journal}>
                <header>
                  <h2>创作过程</h2>
                  <button aria-label="收起" onClick={() => J(false)}>
                    <X size={16} />
                  </button>
                </header>
                <section
                  className={cx("journal-body")}
                  ref={conversation}
                  onWheel={(e) => {
                    const el = e.currentTarget;
                    following.current =
                      e.deltaY > 0 &&
                      el.scrollHeight - el.scrollTop - el.clientHeight < 160;
                  }}
                >
                  <Activity
                    runs={runs}
                    work={work}
                    openTrace={(id) => {
                      history.pushState(null, "", "/traces/" + id);
                      T(true);
                    }}
                  />
                </section>
              </aside>
            </div>
          )}
          {error && !work && (
            <div className={cx("toast-error")} data-floating role="alert">
              <span>{error}</span>
              <button aria-label="关闭" onClick={() => E("")}>
                <X size={13} />
              </button>
            </div>
          )}
        </main>
        {dialog === "settings" && <SettingsDialog close={() => D("")} />}
        {dialog === "materials" && (
          <MaterialsDialog
            close={() => D("")}
            pick={(m) => {
              Q(
                (q) =>
                  (q ? q + "\n" : "") +
                  `${selected ? "选中的部分" : "当前场景"}使用素材「${m.name.zh}」（${m.id}）`,
              );
            }}
          />
        )}
        {dialog === "history" && work && (
          <HistoryDialog
            id={work.id}
            current={work.revision}
            close={() => D("")}
            restore={(r) => void attempt(() => restore(r))}
          />
        )}
      </div>
    </LocaleContext.Provider>
  );
}
function Auth({
  done,
}: {
  done: (user: { id: string; name: string }) => void;
}) {
  const [signup, S] = useState(false),
    [name, N] = useState(""),
    [password, P] = useState(""),
    [error, E] = useState("");
  return (
    <div className={cx("home")}>
      <section className={cx("auth")}>
        <Lantern size={40} className={cx("hero-mark")} />
        <h1>DrawY</h1>
        <p>每个想法，都值得探索</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              done(
                await api("/auth/" + (signup ? "register" : "login"), "POST", {
                  name,
                  password,
                }),
              );
            } catch (e) {
              E(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          <input
            aria-label="用户名"
            placeholder="用户名"
            autoComplete="username"
            value={name}
            onChange={(e) => N(e.target.value)}
            required
          />
          <input
            aria-label="密码"
            placeholder="密码"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => P(e.target.value)}
            required
            minLength={6}
          />
          <button className={cx("primary")}>
            {signup ? "创建账号" : "登录"}
          </button>
          <button
            type="button"
            className={cx("auth-switch")}
            onClick={() => S(!signup)}
          >
            {signup ? "已有账号，登录" : "创建一个账号"}
          </button>
          {error && <p className={cx("error")}>{error}</p>}
        </form>
      </section>
    </div>
  );
}
