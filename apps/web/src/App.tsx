import { SceneView, DetailView } from "./SceneView.tsx";
import { Activity } from "./Activity.tsx";
import { OrbitSketch } from "../../../modules/ui/brand/orbit.tsx";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Paperclip,
  Plus,
  Settings2,
  LogOut,
  History,
  Palette,
  Undo2,
  Square,
  ChevronRight,
  Trash2,
  MessageCircle,
  X,
  PanelLeft,
} from "lucide-react";
import { Lantern, PanelMark } from "@drawy/ui/brand";
import { ModelSketch, KinshipSketch } from "@drawy/ui/sketches";
import { Dialog, Spinner, LocaleContext, Tooltips } from "@drawy/ui";
import { api } from "./api.ts";
import { cx } from "./cx.ts";
import { SettingsDialog, MaterialsDialog, HistoryDialog } from "./Dialogs.tsx";
import type {
  Work,
  Run,
  Asset,
  Selection,
  Target,
} from "../../../modules/contracts/index.ts";
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
    [assets, A] = useState<Asset[]>([]),
    [selected, S] = useState<Selection>(),
    [detailId, setDetail] = useState<string>(),
    [chat, C] = useState(false),
    [offline, G] = useState(false),
    [busy, B] = useState(false),
    [outline, N] = useState(false),
    [query, F] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const following = useRef(true);
  const current = useRef(work);
  current.current = work;
  const run = runs.at(-1),
    working = run && ["running", "viewing"].includes(run.status);
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
    R(await api("/works/" + id + "/runs"));
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
  }, [chat]);
  useEffect(() => {
    const el = conversation.current;
    if (el && following.current)
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [runs]);
  useEffect(() => {
    const pop = () => {
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
    C(false);
    if (push) history.pushState(null, "", "/");
  }
  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const data = new FormData();
      data.append("file", file);
      const a = await api<Asset>("/assets", "POST", data);
      A((old) => [...old, a]);
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
            })
          : await api<Run>("/works/" + w.id + "/runs", "POST", {
              prompt: request,
              sceneId: target,
              assets: assets.map((a) => a.id),
            });
      R((old) =>
        old.some((x) => x.id === r.id)
          ? old.map((x) => (x.id === r.id ? r : x))
          : [...old, r],
      );
      Q("");
      A([]);
      C(true);
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
      className={cx(homePage ? "composer" : "ask-bar")}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void attempt(() => upload(e.dataTransfer.files));
      }}
    >
      {!homePage && <Lantern size={28} className={cx("ask-mark")} />}
      <div className={cx("drawy-input")}>
        {selected && !homePage && (
          <div className={cx("ask-quote")}>
            <span>{selected.label.slice(0, 80)}</span>
            <button onClick={() => S(undefined)} aria-label="清除选择">
              <X size={12} />
            </button>
          </div>
        )}
        {!!assets.length && (
          <div className={cx("composer-attachments")}>
            {assets.map((a) => (
              <span className={cx("attached-image")} key={a.id}>
                <img src={a.url} />
                <button
                  onClick={() => A((old) => old.filter((x) => x.id !== a.id))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          aria-label="描述你想绘制的内容"
          placeholder={
            homePage
              ? "想探索什么？"
              : run?.status === "waiting"
                ? "回答问题…"
                : selected
                  ? "如何修改选中的内容？"
                  : "继续探索，或修改这幅作品…"
          }
          value={prompt}
          rows={homePage ? 2 : 1}
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
      </div>
      <div className={cx(homePage ? "composer-tools" : "drawy-input-actions")}>
        <button
          className={cx("composer-attach")}
          aria-label="上传参考图"
          onClick={() => picker.current?.click()}
        >
          <Paperclip size={17} />
        </button>
        {working ? (
          <button
            className={cx("stop-button")}
            aria-label="停止生成"
            onClick={() =>
              void attempt(() => api("/runs/" + run.id + "/cancel", "POST"))
            }
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            className={cx("composer-send")}
            aria-label="发送"
            disabled={busy || !prompt.trim()}
            onClick={() => void attempt(() => send())}
          >
            {busy ? <Spinner size={16} /> : <ArrowUp size={18} />}
          </button>
        )}
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
              <span className={cx("rail-brand")}>
                <Lantern size={24} />
                <b className={cx("drawy-wordmark")}>DrawY</b>
              </span>
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
                  className={cx("rail-search")}
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
                aria-label="模型设置"
                onClick={() => D("settings")}
              >
                <Settings2 size={19} />
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
                <LogOut size={18} />
                <span className={cx("rail-label")}>{user.name}</span>
              </button>
            </div>
          </nav>
        )}
        <main
          className={cx("app-main")}
          style={!user ? { marginLeft: 0 } : undefined}
        >
          {user === undefined ? (
            <div className={cx("stage-status")}>
              <Spinner />
            </div>
          ) : !user ? (
            <Auth done={U} />
          ) : !work ? (
            <div className={cx("home")}>
              <section className={cx("hero")}>
                <h1 className={cx("hero-title")}>
                  <Lantern size={44} className={cx("hero-mark")} />
                  每个想法，都值得探索
                </h1>
                {composer(true)}
                <nav className={cx("examples")}>
                  {examples.map((text, i) => {
                    const Sketch = sketches[i];
                    return (
                      <button
                        className={cx("example")}
                        key={text}
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
            <div className={cx("workspace")}>
              <div className={cx("workspace-body")}>
                <section className={cx("exploration")}>
                  <header className={cx("stage-bar")}>
                    <div className={cx("stage-lead")}>
                      <button aria-label="场景目录" onClick={() => N(!outline)}>
                        <PanelLeft size={18} />
                      </button>
                      <nav className={cx("drawy-crumbs")}>
                        {crumbs.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && <ChevronRight size={12} />}
                            <button
                              onClick={() => void attempt(() => enter(p.id))}
                            >
                              {p.title}
                            </button>
                          </span>
                        ))}
                      </nav>
                    </div>
                    <div className={cx("drawy-actions")}>
                      <span className={cx("save-status")}>
                        {working ? "正在绘制…" : `已保存 · ${work.revision}`}
                      </span>
                      <button
                        title="撤销"
                        disabled={working || work.revision < 2}
                        onClick={() =>
                          void attempt(() => restore(work.revision - 1))
                        }
                      >
                        <Undo2 size={18} />
                      </button>
                      <button title="版本历史" onClick={() => D("history")}>
                        <History size={18} />
                      </button>
                      <button title="素材" onClick={() => D("materials")}>
                        <Palette size={18} />
                      </button>
                      <button title="对话" onClick={() => C(!chat)}>
                        <MessageCircle size={18} />
                      </button>
                    </div>
                  </header>
                  {outline && (
                    <aside className={cx("drawy-outline")}>
                      {Object.values(work.scenes).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => void attempt(() => enter(p.id))}
                        >
                          {p.parentId ? "↳ " : ""}
                          {p.title}
                        </button>
                      ))}
                    </aside>
                  )}
                  {active?.modules.length ? (
                    <SceneView
                      key={work.id}
                      work={work}
                      sceneId={sceneId}
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
                            await api(
                              "/works/" + work.id + "/modules",
                              "PATCH",
                              { sceneId, baseRevision: work.revision, moves },
                            ),
                          );
                        })
                      }
                    />
                  ) : (
                    <div className={cx("stage-status exploration-main")}>
                      <Lantern size={42} />
                      <p>
                        {working ? "正在把你的想法画出来…" : "从一个想法开始"}
                      </p>
                    </div>
                  )}
                  {detailId && work.details[detailId] && (
                    <DetailView
                      detail={work.details[detailId]}
                      close={() => setDetail(undefined)}
                    />
                  )}
                  <div
                    className={cx("ask drawy-ask")}
                    data-open={chat || undefined}
                    data-state={working ? "working" : "idle"}
                    data-shape="pill"
                  >
                    {chat && (
                      <section
                        className={cx("drawy-conversation")}
                        ref={conversation}
                        onWheel={(e) => {
                          const el = e.currentTarget;
                          following.current =
                            e.deltaY > 0 &&
                            el.scrollHeight - el.scrollTop - el.clientHeight <
                              160;
                        }}
                      >
                        <header>
                          <span>与 DrawY 一起探索</span>
                          <button
                            aria-label="收起对话"
                            onClick={() => C(false)}
                          >
                            <X size={16} />
                          </button>
                        </header>
                        <Activity runs={runs} work={work} offline={offline} />
                        {run?.status === "waiting" && (
                          <div className={cx("drawy-question")}>
                            <strong>{run.question?.text}</strong>
                            {run.question?.options.map((o) => (
                              <button
                                className={cx("secondary")}
                                key={o}
                                onClick={() => void attempt(() => send(o))}
                              >
                                {o}
                              </button>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                    {composer(false)}
                  </div>
                </section>
              </div>
            </div>
          )}
        </main>
        {error && (
          <div className={cx("drawy-error")} role="alert">
            {error}
            <button onClick={() => E("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {dialog === "settings" && <SettingsDialog close={() => D("")} />}{" "}
        {dialog === "materials" && (
          <MaterialsDialog
            close={() => D("")}
            pick={(m) => {
              Q(
                `将${selected ? "选中的区域" : "当前场景"}使用的素材改为“${m.name}”，地址 ${m.url}${m.kind === "personal" ? `，assetId ${m.id}` : ""}`,
              );
              C(true);
            }}
          />
        )}
        {dialog === "history" && work && (
          <HistoryDialog
            id={work.id}
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
      <section className={cx("hero drawy-auth")}>
        <h1 className={cx("hero-title")}>
          <Lantern size={44} />
          DrawY
        </h1>
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
              E(String(e));
            }
          }}
        >
          <label>
            用户名
            <input
              autoComplete="username"
              value={name}
              onChange={(e) => N(e.target.value)}
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => P(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <button className={cx("primary full")}>
            {signup ? "创建账号" : "登录"}
          </button>
          <button
            type="button"
            className={cx("drawy-switch")}
            onClick={() => S(!signup)}
          >
            {signup ? "已有账号，登录" : "创建一个账号"}
          </button>
          <p className={cx("error")}>{error}</p>
        </form>
      </section>
    </div>
  );
}
