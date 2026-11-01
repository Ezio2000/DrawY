# AGENTS.md

DrawY 是一个让 AI 画可探索、可修改的图的 Web 应用。用户提出请求后，“作者”（创作模型）先定下创作简报，再用工具写出作品：可复用的画法代码、由模块实例组成的场景、交互脚本。浏览器运行时执行这些代码，截图服务把画面拍下来送回作者，作者看过后继续改。产品里没有预设的图种，所有画法都由作者编写，所以大多数改动都会落在“作品协议、作者的工具与提示词、运行时 API”这条链上。

README 是写给人看的产品介绍。本文件写给在仓库里干活的 agent，内容可以独立使用。用户可见的行为或架构变了，两边都要更新：README 讲用户会看到什么，本文件讲改代码时需要知道什么。

## 命令

这是一个 pnpm workspace，`modules/ui` 是 `@drawy/ui`，`materials` 是 `@drawy/materials`。运行需要 Node 25，存储依赖它内置的 `node:sqlite`。TypeScript 由 tsx 直接执行，不预编译。

```sh
pnpm install
pnpm typecheck                                    # tsc --noEmit；项目没有 linter
pnpm build                                        # dist/web（前端）与 dist/runtime/runtime.js（运行时 IIFE）
pnpm test                                         # 先 build 再 vitest run
pnpm exec vitest run modules/agent/agent.test.ts  # 单个文件
pnpm exec vitest run -t "用例名片段"               # 单个用例
docker compose up -d --build                      # 完整部署，访问 http://localhost:8088
```

`modules/runtime/runtime.test.ts` 会加载 `dist/runtime/runtime.js`，并在 Playwright Chromium 里执行。所以只要改了 `modules/runtime`、`modules/observation/capture.ts` 或它们依赖的协议代码，就要先 `pnpm build`，否则测到的是旧的 bundle。其他测试不依赖构建产物。

本地开发要同时起几个进程：
- `pnpm --dir materials start`：素材服务，端口 8090，数据在 `data/materials`。
- `pnpm exec tsx apps/capture/main.ts`：截图服务，端口 8091。
- `pnpm server`：主程序，端口 8080，数据在 `data`，同时提供 `dist/runtime` 和 `dist/web` 的静态文件。
- `pnpm dev`：Vite 前端，把 `/api`、`/materials`、`/runtime` 代理到 8080。

PlantUML 服务只在 compose 里有，默认地址是 `http://localhost:8092`。服务地址可以用 `DRAWY_MATERIALS_URL`、`DRAWY_CAPTURE_URL`、`DRAWY_PLANTUML_URL`、`DRAWY_INTERNAL_URL` 覆盖，其中最后一个是截图服务回访主程序的地址。`data/` 存的是真实的用户数据，测试和调试时用临时目录，不要清理或改写它。

## 一次运行如何流动

1. 用户在某个场景发出请求。`apps/server/app.ts` 收到 `POST /api/works/:id/runs`，调用 `modules/agent` 的 `Agent.start`。
2. 同一作品的对话上下文会延续：新一次运行沿用上一次运行保存的 `input`，再追加用户消息和作品当前的状态。用户在两次运行之间自己改过作品（手动编辑、撤销或恢复）时，状态前面会列出作者上次保存之后哪些模块被改、移动、添加或删除（`editing.changesBetween`），提示词要求作者保留这些修改。
3. 作者按 `modules/agent/tools.ts` 里定义的工具工作：
   - `ask_user` 暂停运行，状态变为 `waiting`，用户回答后由 `resume` 继续。
   - `set_brief` 定下简报。
   - `find_materials` 检索素材库。
   - `generate_images` 在后台生成图片（`modules/images`）。这些图片先在素材库里预留 ID，作者马上就能引用。
   - `read_work` 读取作品，`write_work` 修改作品，`view_canvas` 截图查看。
4. `write_work` 交给 `modules/workspace` 原子提交。提交时校验 `baseRevision`，不一致时返回 409；把作品新提到的素材从素材库取进作品的 `materials` 快照，不再提到的移出去；再校验整个作品，最后由 `modules/storage` 写成一个新版本，记下 `Cause`。
5. `view_canvas` 经 `modules/observation` 请求截图服务。截图服务用 `modules/runtime/document.ts` 生成页面，加载 `/runtime/runtime.js` 渲染场景，截下图片，连同几何信息一起作为图片消息送回同一段对话。
6. 运行过程中的每个变化，都以 `run` 事件经 SSE（`/api/events`）推给前端。前端由 `modules/canvas` 把过程画成铅笔起稿和图片显影的动画。整个过程同时由 `modules/trace` 记入 `trace.sqlite`。

## 手动编辑如何流动

用户在绘图页点铅笔（或双击画上的文字）进入编辑模式，右侧面板换成 `apps/web/src/Editor.tsx`。编辑模式下 `Canvas.setEditing(true)`：画布在捕获阶段接住点击，画法里的按钮和模块的跳转目标都不响应；单击选中，Shift 多选，任何模块按下即可拖动；双击按坐标找到模块影子 DOM 里的文字或图片，交给 `options.point`。

每个操作都是 `modules/editing` 里的纯函数，从当前作品算出一份 `WorkEdit`：`setData`、`setStyle`、`moveParts`、`removeParts`（连带删掉相关连线和检查）、`duplicate`（复制品自成一组，并复制它们之间的连线）、`arrange`、`add`、`replace`。`replace` 先在模块数据里找要改的字或图片 ID；找不到时，如果它在画法代码里只出现一次，就按所在位置转义后替换，画法被别的模块共用时先为这个模块复制一份，替换后代码必须还能解析；都不行就返回 `null`，前端把修改要求写进输入框交给作者。`fieldsOf` 决定面板显示哪些控件：先是画法 `params` 声明的（作品画法自带名字，库画法的名字来自 `i18n.tsx` 的 `edit.params`），再是数据里其余的文字、颜色、数字和开关；小写的英文单词当作代码里的状态，不显示。

前端的 `change()` 把这些修改排成队，依次从上一次结果出发，经 `POST /api/works/:id/edits` 交给 `writeWork`，原因记为 `{ kind: "edit" }`，作者运行期间返回 409。用户自己造成的版本（手动编辑、撤销、重做）在画布上安静替换，不播放起稿动画。重做只在撤销后作品没有别的变动时可用，记录在前端。

## 模块职责

`modules/` 下各模块之间用相对路径（`../x/index.ts`）互相引用。

- `contracts`：作品协议（`Work`、`Scene`、`Instance`、`Link`、`Drawing`、`Brief`、`WorkEdit`）、运行记录（`Run`、`Step`、`ToolActivity`）和设置。前后端、运行时和作者工具共用这一份 schema，它是协议的唯一来源。
- `workspace`：`createWork`、`writeWork`、`setBrief`、`restore`、`undo`，以及 `validateWork`。
- `editing`：把手动操作变成 `WorkEdit` 的纯函数、面板控件的推断（`fieldsOf`），以及两个版本之间的差别（`changesBetween`）。前后端都用，不依赖存储和素材库。
- `runtime`：画法执行环境。画法接收 `api`（`svg/html/mermaid/plantuml/material/materials/draw/effect/emit`），交互脚本使用 `on/set/move/openScene/openDetail/animate/cleanup`。打包入口是 `browser.ts`，`scene.ts` 负责场景，`fixture.ts` 供测试使用。
- `agent`：运行循环与重试（`index.ts`）、工具 schema（`tools.ts`）、系统提示词与素材目录（`prompts.ts`），以及解析流式到达的工具参数（`partial.ts`）。
- `models`：用 OpenAI Responses 格式调用创作模型和生图模型，支持 API Key 和 ChatGPT OAuth 两种方式，并负责缓存键。
- `observation`：截图服务的客户端。`capture.ts` 在截图容器里运行，运行时测试也直接调用它。
- `images`：按作品风格生成图片，并把结果回报给作者。
- `materials`：主程序访问素材服务的一层，只经 `@drawy/materials/client` 访问，不直接读素材库的数据库。
- `canvas`：前端画布，负责视角、选择（含多选）、移动、缩放、编辑模式和起稿动画（`ink.ts`）。
- `storage`、`identity`：按用户隔离的 `data/drawy.sqlite`，以及账号。
- `trace`：基于 AsyncLocalStorage 嵌套记录，任何模块都可以直接调用 `tracer`，不需要层层传参。
- `ui`：共享的 React 组件和品牌素材。

`materials/` 是独立的素材包和服务，有自己的 SQLite、文件和检索。素材分四种：`picture`、`drawing`、`effect`、`style`。策展素材在 `materials/seed`：画法源码在 `seed/drawings/<id>.js`，元数据和示例数据在 `drawings.json`，图片在 `seed/files`。`apps/web` 是 React 19 前端，用 CSS Modules 写样式，图标用 lucide-react。

## 改动时需要知道的约束

**协议改动要沿整条链同步。** 先改 `contracts`，然后检查这些地方：
- `workspace` 的校验；
- `runtime` 的读取；
- `agent/tools.ts` 的工具 schema；
- `agent/prompts.ts` 里对作者的说明；
- `partial.ts` 的流式解析；
- `editing` 的手动编辑和编辑面板；
- 前端的调用方；
- 相关测试。

这样做的原因是，作者只能通过 schema 和提示词知道协议长什么样，任何一处没跟上，模型就会写出无效的作品。画法参数的类型（`contracts` 的 `paramTypes`）也是素材库 `Param` 的可编辑类型，两边一起改。`instanceSchema` 里布局字段排在内容字段前面，这是有意的：工具参数按字段顺序流式到达，画布可以先画出构图，再等画法代码。调整字段顺序时要保持这个效果。

**提示词前缀要保持逐字节稳定。** 同一用户的请求共用一个缓存键。系统提示词里的素材目录只写随代码变化的内容，并按 id 排序，不放图片数量、使用次数这类随数据变化的内容。这样新作品的第一轮和作品续画都能命中缓存。

**修改作者提示词和工具说明时，遵循 `prompts.ts` 文件头引用的 Opus 5.5 与 GPT-6 Astra 官方指南。** 用英文写，平实直接，每条要求附上原因，不用大写或 MUST 之类的强调，规则要写具体，不写泛泛的告诫。作者的行为契约也写在这些提示词里：
- 主题说不清时用 `ask_user` 一次问清；
- 简报的依据要逐字引用用户说过的话（`setBrief` 会校验）；
- 结束前必须看过最新版本的所有非空场景，并且截图里没有运行错误（`requireObserved`）。

改提示词前先读一遍现有的 `AUTHOR`，在原有结构里修改，不要另起一套写法。

**面向用户的文字要中英双语。** 前端文案在 `apps/web/src/i18n.tsx`，以 `zh` 为基准，`en` 必须有相同的键；共享组件的文案在 `modules/ui/src/words.ts`。服务端内部说中文，错误在离开服务时由 `modules/contracts/messages.ts` 按请求的语言翻译，所以新增的错误信息要在那里补上英文。写给模型的文字保持原样，不翻译。

**测试要验证真实行为。** `agent.test.ts` 用 `vi.mock` 替换掉 `models` 和 `observation`，按脚本逐轮返回工具调用。素材相关的测试用 `@drawy/materials/testing` 的 `serveLibrary`，在临时目录里起一个带种子数据的真实素材库，并拦截 fetch。新测试沿用这两种方式，不要另写素材库的 mock。测试失败时，先判断是实现错了还是测试过时了，不要为了让测试通过去改断言或写特例。

**`promo/` 是独立工程。** 它是 60 秒宣传片，有自己的 npm 依赖和 `build.sh`，不属于主程序的构建和测试；只有任务明确涉及时才去动它。
