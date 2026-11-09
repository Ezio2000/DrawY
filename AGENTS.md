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
pnpm test:desktop                                 # 先 build 再只跑作品页（电脑、手机、平板）的回归验证
pnpm exec vitest run modules/agent/agent.test.ts  # 单个文件
pnpm exec vitest run -t "用例名片段"               # 单个用例
docker compose up -d --build                      # 完整部署，访问 http://localhost:8088
```

`modules/runtime/runtime.test.ts` 会加载 `dist/runtime/runtime.js`，并在 Playwright Chromium 里执行。所以只要改了 `modules/runtime`、`modules/observation/capture.ts` 或它们依赖的协议代码，就要先 `pnpm build`，否则测到的是旧的 bundle。`apps/web/regression/` 下的作品页回归验证测的是构建出的 `dist/web`，改了前端也要先 build。其他测试不依赖构建产物。Playwright 自带的浏览器没装时，作品页的回归验证可以用 `DRAWY_CHROMIUM` 指定一个 Chromium 可执行文件。

本地开发要同时起几个进程：
- `pnpm --dir materials start`：素材服务，端口 8090，数据在 `data/materials`。
- `pnpm exec tsx apps/capture/main.ts`：截图服务，端口 8091。
- `pnpm server`：主程序，端口 8080，数据在 `data`，同时提供 `dist/runtime` 和 `dist/web` 的静态文件。
- `pnpm dev`：Vite 前端，把 `/api`、`/materials`、`/runtime` 代理到 8080。

主程序用 `hono/compress` 压缩文本响应（SSE 和图片不压），`/assets/*` 带内容哈希，按 immutable 长期缓存。

服务地址可以用 `DRAWY_MATERIALS_URL`、`DRAWY_CAPTURE_URL`、`DRAWY_INTERNAL_URL` 覆盖，其中最后一个是截图服务回访主程序的地址。`data/` 存的是真实的用户数据，测试和调试时用临时目录，不要清理或改写它。截图镜像只复制它用到的文件，`capture.ts` 多依赖一个文件就要在 `Dockerfile` 的 capture 阶段加上。

## 一次运行如何流动

1. 用户在某个场景发出请求。`apps/server/app.ts` 收到 `POST /api/works/:id/runs`，调用 `modules/agent` 的 `Agent.start`。
2. 同一作品的对话上下文会延续：新一次运行沿用上一次运行保存的 `input`，再追加用户消息和作品当前的状态。保存的对话格式不是当前的 `CONTEXT_FORMAT` 时不续用，换成用户说过的话加整份作品。`Context.known` 记下对话已持有的版本（作者保存、`read_work`、`set_brief` 或压缩后整份给出的那一版），`catchUp` 据此只发变化：没变时只说一句"作品和上次一样"；用户在两次运行之间自己改过作品（手动编辑、撤销或恢复）时，列出作者上次保存之后哪些模块被改、移动、添加或删除，以及哪些场景（含脚本）、画法和详情被增删改（`editing.changesBetween`），并附上这些记录的当前样子（`changedRecords`，模块用作者写的短写法），提示词要求作者保留这些修改；对话里没有这件作品、中间有作者不知道的作者保存，或变化超过整份作品一半时，仍整份发送。用户的长期偏好以 `User preferences: …` 消息放在对话里（`Context.preferences`），变了才再发一次，系统提示词因此对所有用户相同。
3. 作者按 `modules/agent/tools.ts` 里定义的工具工作：
   - `ask_user` 暂停运行，状态变为 `waiting`，用户回答后由 `resume` 继续。`start` 在首次异步操作前读取完整 `Settings`，存入服务端持久化的 `Context.settings`；恢复、绘制循环、压缩、搜索、生图与简报偏好校验都使用此快照，不重读账号设置。`run.services` 和 `run.prices` 从此快照生成，跨作品选择或管理员改价不会影响已有运行；新运行单独读取最新设置，只继承旧运行的对话，不继承配置。完整快照含连接凭证，只存在服务端 context，不放入公开 Run 或 trace。
   - `set_brief` 定下简报。
   - `find_materials` 检索素材库。
   - `draw_guide` 按需读取指南和库画法卡片（渐进式披露，见“提示词的三层”）。
   - `generate_images` 在后台生成图片（`modules/images`）。这些图片先全部在素材库里预留 ID，作者马上就能引用；`develop` 先检查（批内引用不能成环、批外引用必须存在，否则整批不开画），引用同批图片的那张等被引用的显影后才开始（被引用的失败时它也不画），其余并行。每张图除了作者给的内容参考图，还会带上作品里已有的同风格图片和风格样张作为风格参考图（`styleReferences`），保持画风一致。
   - `read_work` 读取作品，`write_work` 修改作品，`view_canvas` 截图查看。`view_canvas` 可单独调用，或放在同轮一个或多个 `write_work` 之后的最后一项；按顺序保存后截图，任一保存失败就跳过本轮截图。`ask_user` 仍需单独调用。没有 `finish` 工具：作者一轮只写文字、没有工具调用时，如果 `Agent.done` 判定可以结束（图片都显影、最新版本看过且没有运行错误），这段文字就是结束语，运行完成；否则把 `done()` 给出的原因作为 "The work is not done yet: …" 消息回给作者。最小字号低于 `MIN_TEXT`（14 像素，取各场景最新全图的 `Observation.smallestText`）时，`done()` 每次运行只拦一次，因为地图自带的地名这类字不由作者决定。
4. `write_work` 交给 `modules/workspace` 原子提交。作者和手动编辑写的是同一个 `WorkEdit`（`contracts` 的 `workEditSchema`，语义写在它上方的注释里，`editing/apply.ts` 的 `layOn` 是唯一实现）：`modules`、`links`、`scenes`、`drawings`、`details` 都是按 ID 平铺的表，已有 ID 只改给出的字段，新 ID 就是新增；ID 在整个作品里不重复，已有的部件不用写 `scene`，新部件不写就进当前场景；`bounds` 写成 `[x, y, 宽, 高]`；`data`、`defaults`、`params`、`style` 按键合并（`mergeValue`，RFC 7386：`null` 删除），列表给整个是替换，给 `{"2": {...}}` 是按位置改（位置指这次修改之前的列表，等于长度是追加）；连线的一端是模块 ID（`{moduleId}`，运行时取朝向另一端的边，随模块移动）或 `{moduleId, at}`，`at` 是边或 `[x, y]`；画法的 `source`、场景的 `interaction`、详情的 `html` 可整段写，也可用 `edits`/`interactionEdits` 做 `{find, replace, all?}` 替换（`editedText`：找不到或不唯一就是问题，并给出最接近的一段）；`from` 从作品或库复制一个新画法；`scenes` 另有 `clear`（清空后重构）和 `order`（让列出的模块在它们自己占的层级位置之间换序）；`remove` 最先执行，并连带去掉依赖它的东西（模块的连线和检查、场景的子场景、指向它的跳转），不存在的只在结果里说一句（`notThere`），不拒绝。作者不写 `baseRevision`：运行期间手动编辑一律 409，没有并发；`POST /edits` 的 `{baseRevision, edit}` 才校验版本。提交时把作品新提到的素材从素材库取进作品的 `materials` 快照，不再提到的移出去，已有的库画法和质感换成库里的当前版本（作者的素材目录描述的就是当前版本），再由 `modules/storage` 写成一个新版本，记下 `Cause`。作者读到的作品（`workspace/author.ts` 的 `forAuthor`）和写的是同一种写法，读到的记录可以原样写回。

   拒绝时一次说全：`readEdit` 把 schema 问题、`layOn` 把落不上的记录、`problemsIn` 把引用不到的东西、`pictureProblems` 把这次改到的部件里不存在的图片、`codeProblems` 把这次改的代码里的语法错误都收进 `EditRejected.problems`（`{at, problem}`，`at` 形如 `links.l-a1.from`）；依赖某条落不上的记录的引用不重复报（`pending`）。作者的写入被拒时 `Context.held` 留住它（工具结果说明留住了哪些 ID），下一次带 `amend: true` 的写入只发改正的部分，`composed` 按 ID 把两次合成一次，作为一个版本保存；参数不是合法 JSON 时 `completedRecords` 留住已经完整到达的记录，同样可以 `amend`。不带 `amend` 的写入替换留住的内容。
5. `view_canvas` 经 `modules/observation` 请求截图服务。截图服务用 `modules/runtime/document.ts` 生成页面，加载 `/runtime/runtime.js` 渲染场景，截下图片，作为图片消息送回同一段对话。默认每个场景一张开场全图（加声明的交互检查），没有自动网格局部图；`regions` 按需加最多三张局部，取景框按区域比例定，不发多余画面；同一版本已看过全图且无错误时，局部查看只返回局部。交互检查（`checks`）和 `actions` 是给场景脚本和画法里的按钮用的；一次点击打开了详情页时，截图服务不拍它（详情是作者写的 HTML，由应用排版），而是关掉详情、在结果里写明打开了哪一页（`Shot.opened`，没有 `base64`），点的是模块自己的跳转目标时还提示作者把这条检查去掉，因为跳转不需要代码。运行时页面的详情页是铺满屏幕的一层（`data-drawy-detail`），文章在里面保持自己的宽度；内边距不能加在文章本身上，否则会从它 680px 的最大宽度里扣掉。模块几何只放在全图旁，且只列上次之后变了的（`Context.reported`，压缩时清空）。`figure.smallestText`、`figure.tooSmall`（每个字小于 `MIN_TEXT` 的部件）和 `clippedText` 由 `capture.ts` 的 `readText` 在页面里量出，`tooSmall` 的每项带部件当前的 `size` 和看得清要用的 `sizeThatReads`（不管这段字按 `size` 的几成画），`readableFrom` 说明这个图里多大字号才看得清（`geometry.ts` 的 `opening`），一次写入就能全部改好。开场取景比例 `min(1296/宽, 828/高, 1.5)` 和 `note` 按 0.8 倍绘制写在提示词里，作者第一稿就能按它定字号。`claims` 是作者看图前写下的检查项（时间、方向、比例、因果、数字的条件，图里每条路线和支线都要有），放在截图旁要求逐条核对；核对结果不写给用户，进度说明只一句，因为 Opus 5.5 会把一两句以上的说明作为思考块返回。`Observation.overview` 如实记录这次有没有全图，`requireObserved` 要求最新版本有全图、且最后一次查看没有错误。
6. 运行过程中的每个变化，都以 `run` 事件经 SSE（`/api/events`）推给前端。前端由 `modules/canvas` 把过程画成石墨线起稿和图片显影的动画（没有跟着笔尖走的铅笔）。整个过程同时由 `modules/trace` 记入 `trace.sqlite`。前端右侧的画室（`apps/web/src/Studio.tsx`）把每次运行的步骤按工具分别呈现（每种 `ToolActivity` 一个视图，未知的托管工具走 `hosted`），步骤里不标中间稿的编号，只在运行结束处标出成稿是第几版；预览和恢复在单独的版本面板（`Drafts.tsx`）。用户按提问数版本，不管中间过程：`contracts` 的 `historyOf` 把 `/revisions` 归成当前的版本栈和未保存的手动修改（`versionsOf` 只取前者）。同一次运行保存的所有稿算一版，空白画布是第 0 版；手动修改存成 `{ kind: "edit" }` 的修订，不算版本，直到用户 `POST /works/:id/save`（`workspace` 的 `saveEdits`）记下一个 `{ kind: "save" }` 修订，把它们收成一版；只有同一次运行连续的修订会合成一版（`sameRun`）；运行开始前留下的未保存修改并入那次运行的版本。恢复是回退：目标是某版结束时的修订，就回到那一版（恢复修订加进它的 `revisions`，之后的版本离开列表，下一版接着它编号，`sealed` 让下一次修订另起一版）；目标是一条未保存的修改，就回到那一步；目标是某次运行中间的一稿，才另记一个 `restore` 版本。每个版本记着创建时下面的版本（`chain`），所以恢复到已离开列表的版本会把它连同下面的一起带回，前端的“撤销回退”和重做就靠这个。修订本身一直追加、修订号不复用，作者的 `Context.known` 不受影响。面板每版一行，未保存的修改在最上面一行（保存、放弃）；打开它时画布放开选区（桌面壳的 `toggle`、手机壳的 `show`），因为版本是整体看的。点一行在画布上预览，“回到此版”按钮一直可见；`versionOf` 把修订号换成版本号，画室的成稿、预览条、回退后的提示和左侧栏都用它（`WorkProgress.unsaved` 是未保存的修改数）。撤销（`stepBefore`）有未保存的修改时退一步修改，否则退到当前版本的上一版。输入框（`Composer.tsx`）一直在页面下方，模型选择 `ModelBar` 在它右下方，`engaged`（运行中或等待回答）时不显示模型选择；作者运行中（`collapsed`）输入框收起成一条，只有当前进度（`Now`）和停止按钮，等待回答时展开；作者开始运行时画室自动打开。输入框上方的 `unsaved-bar` 提示未保存的手动修改（保存、放弃，⌘S 保存）；有未保存的修改时发请求，会话的 `send` 先把请求挂起（`holding`），让用户选保存后发送、放弃后发送或取消（`decide`）。回到某版和放弃修改后，提示条上可以撤销（会话的 `back`，⌘Z 也走它）。预览版本、回到当前和回退都把修订号放进 `own`，画布安静替换，不重播落笔动画。画室、草稿和编辑面板宽度分开（桌面壳的 `panelWidths`，`--journal`/`--drafts`/`--edit`），由 `Resizer` 拖动并按面板记在 `localStorage`。用量由 `Studio.tsx` 的 `spentBy`/`Stats` 按 `costOf(run.usage, run.prices)` 算出：运行标题行右侧的费用按钮展开这次的卡片（费用、token 与缓存命中、耗时、搜索、图片几块数字，按服务分色的费用构成条，每个服务一行），画室顶部的累计行展开整个作品的同样卡片。回复用 `Markdown.tsx` 渲染，`tidy` 去掉模型留下的 `\ue200…\ue201` 引用记号并移动引用位置。

托管工具（模型服务方自己执行、输出项类型以 `_call` 结尾的，如 `web_search_call`）在 `agent/index.ts` 里统一处理：成为运行步骤（`web_search` 有专门的活动，其余是 `{ name: "hosted", tool, detail }`），按 `run.usage.hosted` 计数，并用 `tracer.record` 记成所在轮次下的 `tool` 记录（`attrs.hosted`、`args` 是动作、`output` 是原始项）。`trace` 的 `meters` 按 `attrs.meter`、工具名或种类汇总次数、耗时和 token，所以新增工具不用改 trace。`run.usage` 累计每轮和压缩的 token、托管工具次数与生图用量（`images` 从图片接口返回的 `usage` 取）。搜索是否合理由 `prompts.ts` 的 `# Research` 一节约束，`set_brief` 和 `view_canvas` 的结果在本次运行搜索过时附上 `research`（次数、打开过的网页），提醒作者按已有来源判断。硬预算在 `steering`：每次请求 `SEARCH_LIMIT` 次、第一稿保存后 `SEARCH_AFTER_DRAFT` 次，预算内的轮次带 `max_tool_calls`，用完后带 `tool_choice: allowed_tools`（只列函数工具）；两者都不改 `tools`，所以不破坏缓存前缀，不要改成增删 `tools` 的做法。轮次的 trace 在 `request.steer` 里记下这次的限制。

导出：`/api/works/:id/scenes/:scene/picture`（PNG，`?format=pdf` 为一页矢量 PDF，截图服务 `render` 的 `format`），`/page` 是可离线打开的单文件交互网页（`runtime/document.ts` 的 `standaloneDocument`：内嵌 `dist/runtime/runtime.js` 和作品图片；SVG 以文本 data URL 内嵌，`scene.ts` 在它上面替换 `currentColor` 完成着色；详情 HTML 和画法代码里写成地址的 `/materials/files|thumbs/…` 也连同查询串整个换成 data URL（`color` 交给素材库着色、`size` 定缩略图大小，HTML 里的 `&amp;` 也认），SVG 的引号和括号一并转义；以 `/` 开头的 fetch 改到导出时的站点，`/materials/geo` 因此带 `Access-Control-Allow-Origin: *`）。JPG、社交卡片、复制和系统分享在前端由 PNG 生成（`Export.tsx`）。剪贴板和系统分享要在点击的临时授权内调用，截图可能要好几秒：复制在点击时立即 `clipboard.write`，传入图片的 Promise；分享不能等，所以菜单一打开就开始截图，图好之前分享项显示准备中，点击时直接 `share`。

## 创作、搜索与生图的组合

模型配置的结构是“规格 + 适配器”，新增接入方式、接口格式或搜索服务商都是加条目，读它们的代码不改：
- `contracts/models.ts`（由 `contracts/index.ts` 转出）是唯一说明“谁能做什么”的地方：`channelSpecs`（`api`/`oauth` 各自的固定地址、能说的接口格式、速度档、能否内置搜索、能否固定提供商、要不要 Account ID）、`protocolSpecs`（每种接口格式的官方地址、能否内置搜索、是否有速度档）、`searchProviderSpecs`（地址、是否必须有 Key、是否由服务商读网页）。`settleWriter`/`settleProvider` 按规格改正模型（格式不被支持时退回接入方式的第一种、内置搜索不能用就不开放、可选速度只留连接和格式提供的、默认档位取可选的），`modelCatalogSchema` 和设置页都用它；`reconnect` 在供应商换接入方式时把地址换成 `endpointFor` 给的地址。`offersBuiltinSearch`、`speedsOf`、`pinnedProvider`、`searchReady`、`protocolFor`（新模型按地址猜格式）都从规格推出。`picked`/`settingsFor`/`menuFor` 是“用户选了哪个档位、落到哪个组合”的唯一实现，`UserStore.settings()` 和 `/api/models` 只调用它们；`costOf` 是费用的唯一算法，前端账单和运行记录都用它。
- `modules/models` 每种格式一个适配器（`responses.ts`、`chat.ts`、`anthropic.ts`，接口见 `types.ts` 的 `Adapter`），在 `index.ts` 的 `adapters: Record<Protocol, Adapter>` 里登记。`generate(role, turn)` 收一个 `Turn` 对象（`instructions/input/tools/signal/onEvent/budget/cacheKey/steer/effort`），先做通用处理（凭证检查、`blind`、输出上限），再交给适配器。按格式不同的行为都问适配器：`effortControl`（`request` 每次请求带档位、`conversation` 在对话里插 `configuration_update`、`fixed` 只能改请求级强度）决定 `agent` 的 `withLessThought` 和 `holdEffort`；`narrow` 决定 `steering` 能否不改工具列表就收窄（只有 Responses 有）；`describe` 给 trace 的 `request` 补字段（Responses 的 `serviceTier`），由 `requestOf` 合成。`http.ts` 放共用的 `headers`、`post`（自动带 `pinnedProvider`）和 SSE 读取 `events`。`agent` 里不再出现按 `protocol` 分支的代码，加格式时也不要再加。
- `modules/search` 的 `clients: Record<SearchProvider, Client>` 每个服务商一项：`search`，以及服务商自己读网页时的 `read`（没有就由 DrawY 直接读）。
- 设置页 `apps/web/src/ModelSettings.tsx`：`WriterSection` 和 `ImageSection` 共用 `ProviderSection`（供应商列表，展开是连接字段和它的模型列表；两者的差别写成一个 `Kind`），`SearchSection` 列搜索服务并设默认联网方式。添加供应商从 `presets` 起步；默认模型不能删，它所在的供应商也不能删。`ConnectionFields` 按规格只显示适用的控件（Account ID），模型的格式、固定提供商、可选速度和缓存写入价格只在适用时出现。价格用 `NumberField`（文字输入、保存数字）。行、分组、条目这些通用部件在 `SettingsParts.tsx`。档位页（`LabelSection`）在标题行标出不可用的档位并列出原因；强度和速度用 `ChooseOrDefault`，第一项是“模型默认”，速度列出连接支持的全部档位（只开放一个时也能选），选了模型没开放的速度就同时改那个模型的 `speeds`（`offering`）；档位可上移下移（即菜单顺序）、复制、设为默认。模型条目标出用到它的档位，可复制。新的接入方式、格式或服务商要在 `i18n.tsx` 的 `settings.channels/credentials/protocols/protocolHints/providers/providerHints` 补中英文，类型检查会提示缺哪一项。

`ModelCatalog` 里三样东西分开配置：`writers`（绘制供应商，每个 `Provider` 是连接加 `models: WriterModel[]`）、`painters`（生图供应商，`models: ImageModel[]`）、`searches`（搜索服务）。用户只能选“档位”（`labels: ModelLabel[]`，管理员在设置的“档位”页配置）：每个档位有名称、说明，以及绘制模型、可选的强度和速度（不填用模型默认）、搜索方式 `web` 和生图模型；`modelCatalogSchema` 校验档位引用的模型和搜索都存在、ID 不重复、`defaults.label` 是其中之一。没有配置档位时 `labelsOf` 用 `defaults: { writer, image, web }` 合成一个 `default` 档位，所以 `defaults` 仍是"未配置档位时的组合"，也是新档位的起点。被档位用到的模型和它所在的供应商在设置页不能删。模型 ID 在同类里全局唯一；显示名默认是 `writerLabel`/`imageLabel` 给的 `模型[供应商]`（固定了 OpenRouter 提供商时是 `模型[供应商/提供商]`），填了 `name` 就用它。`WriterModel` 记管理员开放给用户的 `efforts`/`speeds`/`builtinSearch` 和各自的默认 `effort`/`speed`，以及价格 `prices`（每百万 token 的 `input/cached/cacheWrite/output`、内置搜索每次 `search`）和速度倍率 `speedRates`（缺省取 `speedRates` 常量）；`ImageModel.prices`（`ImagePrices`）是每张图，以及 Images API 分开计价的 `textInput`/`imageInput`/`output`/`textOutput` 每百万 token：`imageTokensOf` 按响应里的 `input_tokens_details`/`output_tokens_details` 拆开（不拆的服务商全算文字输入），`run.usage.images` 分别累计，所以带风格参考图的生图按图片输入价计算；`SearchService.prices` 是每次查询和每次读网页。存的目录读不通时 `Storage.models()` 换成 `defaultCatalog()`，不做旧格式迁移。`UserSettings` 只记 `preferences` 和 `label`（可为空）；`PUT /api/settings` 用 `settingsChangeSchema` 接收，其他字段丢弃。`picked` 落定：档位不在了用 `defaults.label`，再不在用第一个；强度取模型可选里最近的，速度不可选就用模型默认；`web` 是 `off`、`builtin` 或搜索服务 ID（服务 ID 不能叫这两个名字），经 `webFor` 落定——要内置搜索而模型没有、或服务没有 Key 时是 `off`。`UserStore.settings()`（即 `settingsFor`）合成 `Settings`：`label`（档位名）、`author`（运行时的 `Role`）/`authorName`、`search: { mode, service? }`、`image`/`imageName`，以及这次的 `prices`（`RunPrices`：按速度倍率换算后的 token 价格、按搜索方式取的每次搜索和读网页价格、生图价格）。

运行时的 `Role` 是供应商连接加所选模型和选项：`protocol`（`responses`、`chat` 或 `anthropic`，ChatGPT OAuth 只能是第一种）、`vision`、`tools`、`effort`/`speed`（用户选的）、`efforts`（模型开放的档位，可以有 `max`）、`maxOutput`。适配器只读 `Role`，不知道目录的形状。`models/index.ts` 的 `generate` 对外只说 Responses 的格式：`protocol: "chat"` 时由 `chat.ts` 把 Responses 项转成 Chat Completions 消息（`toMessages`：同一轮的函数调用合成一条 assistant 消息，夹在调用结果之间的图片消息挪到结果之后，`configuration_update`、托管调用和加密推理丢掉），再把流式块转成同样的事件和项（`reasoning_content` 存成 `{ type: "reasoning", reasoning_content }`，Responses 请求会滤掉它）；不能看图的模型由 `blind` 把图片换成文字。Chat 请求没有 `prompt_cache_key` 和 `tool_choice`，思考强度按请求传 `reasoning_effort`（取 `turn.effort`），所以 chat 适配器的 `effortControl` 是 `request`，不插 `configuration_update`。

`protocol: "anthropic"` 由 `models/anthropic.ts` 的适配器用官方 `@anthropic-ai/sdk` 调 Messages 接口（`baseUrl` 是 `https://api.anthropic.com`，末尾的 `/v1` 会去掉；SDK 不重试，重试交给 agent，错误转成 `模型请求 <状态>` 的说法）。`toAnthropic` 把 Responses 项转成消息：同一轮的模型项合成一条 assistant 消息，调用结果放在下一条 user 消息最前面，结果之间的图片和 `configuration_update` 挪到结果之后；没有工具的请求（压缩摘要）把调用和结果写成文字。Claude 返回的每个项都在 `anthropic` 字段里留着原始内容块（签名的 thinking、带 citations 的 text、tool_use、`server_tool_use` 加搜索结果），下次原样发回，因为较新的模型会校验 thinking 所在的对话前缀；`forResponses` 在发给 Responses 时去掉这些块、Claude 的 thinking 和它自己的搜索，`toMessages` 本来就忽略它们，估算上下文时 `anthropic` 也不计。请求固定带 adaptive thinking（`display: "summarized"`，摘要作为思考步骤显示）、`output_config.effort`、系统提示词和最后一个工具上的 `cache_control` 以及顶层自动缓存；有工具的请求还由 `withTurnBreakpoint` 在模型上一轮最后一个 text 或 tool_use 块上放一个断点（发送时复制，不改存下的块）：缓存只往回找 20 个位置，一轮新增太多内容块时顶层断点够不到上次的缓存，会退回系统前缀整段重写。四个断点已用满，不要再加。函数工具带 `eager_input_streaming` 让画布边流边画。按模型版本（`claudeVersion` 同时接受 `5-5`、`5.5`，以及提供商前缀和日期后缀）加 beta：`perTurnEffort`（Opus ≥ 5、Sonnet/Haiku ≥ 5.5、Fable/Mythos ≥ 5.1）时 `configuration_update` 变成只带 `output_config.effort` 的 system 消息，其他 Claude 模型的强度只能在请求级改；thinking 与对话绑定的模型带 `block_binding: drop_block`，`withoutOldPictures` 之类改写历史时只丢掉失效的 thinking；不带 `fallbacks`：被拒答的轮次不换模型续写，运行以“模型拒绝了这一轮的内容”失败（不重试），已保存的版本保留。内置搜索是 `web_search_20260209`（4.6 以前的模型用 `web_search_20250305`），每次请求 `max_uses` 8 次，`server_tool_use` 和结果合成 `web_search_call` 项，所以步骤、计数和 trace 与 OpenAI 的一样；Messages 没有不改工具列表就收窄工具的办法，适配器没有 `narrow`，`steering` 对它返回空，画出第一稿后的搜索预算只对独立搜索生效。`pause_turn` 在适配层里接着请求；`max_tokens`、`refusal` 和中途断开都按失败处理。工具参数开了 eager 流式，接口不校验，模型可能写出坏 JSON，走 OpenRouter 也没有语法保证（`strict` 不生效）。SDK 的 `.stream()` 遇到坏块就放弃整个流，所以适配器用 `messages.create({stream: true})` 读原始事件、自己累积内容块：坏参数包成 `{INVALID_JSON: 原文}` 留在对话里（Messages 只收对象），项的 `arguments` 仍是原文，用量也完整。`call` 解析失败时按普通工具失败回给作者，由它改正后重发，不用重来一整轮的思考；原文留在 trace 的 `args` 里供分析，同批的 `view_canvas` 被跳过。其他格式的坏参数走同一条路。

一次运行只有一种搜索：`toolsFor(settings)` 在 `builtin` 时加托管 `web_search`，`service` 时加 `tools.ts` 的 `searchTools`（函数 `web_search {queries}` 和 `open_page {url}`，由 `modules/search` 调服务商：DeepSeek 的 `/search`、`/fetch`，Tavily 的 `/search`、`/extract`，Brave 和 SearXNG 只搜索、网页由 DrawY 直接读取并去掉标签），`off` 时都不加。两种搜索都记成 `web_search` 步骤（`open_page` 的 `action` 是 `open_page`），所以 `searchesLeft`、`research` 不分来源；独立搜索的预算在执行时检查，按查询计（`cost`：服务商每个查询收一次费，一次调用带几个查询就算几次；读网页和托管搜索按调用算一次），剩下的不够时只问前面几个查询、结果里用 `notAsked` 列出没问的，预算已用完就去掉这一步并回报搜索已关闭（`research` 对独立搜索给 `searchQueriesLeft`，托管搜索给 `searchCallsLeft`），Responses 协议下用完后还会带 `allowed_tools`（排除两个搜索函数）。`run.usage.searches/pages` 计搜索和读网页次数（托管搜索按 `action` 分，独立搜索的 `searches` 按实际问过的查询数），`run.usage.cacheWrite` 记 Claude 的缓存写入（适配器在 `input_tokens_details.cache_write_tokens` 报出）。`run.services` 记下这次的绘制模型、强度、速度、搜索方式和服务、生图模型的名字，`run.prices` 记下开始时定下的价格，费用是 `costOf(run.usage, run.prices)`，之后改价格不影响已有运行；`/api/traces` 和 `/api/traces/:id` 给每条记录附上对应运行的 `cost` 和 `services`。前端 `Studio.tsx` 的 `spentBy` 只读 `run.usage`，`WorkUsage` 显示作品累计。

模型服务报的错用 `http.ts` 的 `readable` 换成它自己的话（错误对象的 `message` 加 `code`），不把 JSON 原样给用户看：HTTP 错误仍是 `模型请求 <状态>: …`（`transient` 据此决定重试），流里的错误由 `streamError` 按代码分：限流、服务端错误记成对应状态以便重试，其余（额度用完、拒绝请求）是 `模型服务报错：…`，不重试。回复和失败说明在 `Now` 里只显示前两行：限行写在按钮里的 `span` 上，因为 Safari 不对按钮本身限行。作者的结束语只说作品给读者看什么、怎么点开看，不写检查结论（提示词里写明了原因：手机上这段话会盖在画上）；截图旁的 `claims` 说明也要求只在思考里核对、不写进进度和结束语，因为原来的“说出每条是否成立”会让模型把“三项都成立”写给用户。

失败的模型尝试单独计费：`loop` 把每次没完成的尝试（断流、截断、取消）记入 `run.usage.failed`（次数、耗时含等待、输入、缓存、输出），不算进 `input`/`output`；工具参数写坏计 `invalidCalls`（用量在写它的那一轮里，这里只计次数）；生图失败另计失败张数；模型已成功返回的每次图片（包括抠图重画前被弃用的图片）都计入 `run.usage.images` 的张数和 token，后续重试失败也保留已产生的费用。Claude 适配器在流开始和 `message_delta` 时发 `response.usage` 事件报告已知用量，断开时输出没有上报，就按已流式到达的字符数除以 3 估算（`estimated`，不含未显示的思考，所以偏低）；其他格式断流时输入也未知，只有输出估算。`costOf` 单列 `failed` 并计入 `total`，账单在有失败时多一行，失败尝试也作为 `attrs.failed` 的 `turn` 记录进 trace，所以 `meters` 和 token 合计都包含它。

上下文达到 20 万 token 时 `compact` 把对话换成摘要。大小取上一轮 `usage.input_tokens`（记在 `Context.measured`）加之后新增项的估算，估算不计 `encrypted_content` 和图片 base64；摘要请求沿用作者的系统提示词、工具和缓存键，把总结要求作为最后一条用户消息追加在原样的对话后面，所以整段对话从缓存读取；强度在对话里改变的格式在总结要求前追加一个最低档的 `configuration_update`，其余格式在请求上降到 low（会让缓存失效）；输出上限 16k，不设 `tool_choice`（在 Anthropic 上它会让对话缓存失效），作者没写出文字时按失败处理。替换后的对话依次是偏好、摘要和整份作品。摘要失败时只把较早的截图换成文字占位，运行继续。

## 账号、角色与模型

账号的角色记在 `users.role`，角色在 `roles` 表（`storage` 的 `roles/role/saveRole/deleteRole/account/accounts/setRole`，`identity` 的 `saveRole/removeRole` 做校验）。权限清单是 `contracts` 的 `permissions`：`models.manage`、`materials.all`、`materials.manage`、`accounts.manage`。内置角色 `admin` 读出时永远拥有全部权限（以后新增的权限也自动有），不能修改；`member` 是新账号的默认角色，权限可改、不能删；删掉自建角色时它的账号变回 `member`。第一个注册的账号是 `admin`；旧库升级时最早的账号成为 `admin`；`setRole` 不允许去掉最后一位管理员。

注册要邀请码：`identity.signUp` 在库里还没有账号时直接注册（第一个账号设置站点），之后要求一个未使用的邀请码，建账号和标记邀请码已用在同一个事务里，注册失败（比如用户名重复）邀请码仍可再用。邀请码存在 `invites` 表（`storage` 的 `invites/addInvite/useInvite/deleteInvite/hasAccounts`），由 `createInvites` 生成 `XXXX-XXXX` 形式、不含易混字符的码，输入时 `inviteCode` 忽略大小写、空格和连字符。管理接口 `/api/admin/invites`（列出、生成 `{count}`、删除未使用的）要 `accounts.manage`；已用的邀请码不能删，留作谁凭它进来的记录。注册页先问 `GET /api/auth/signup`（不需登录）是否要邀请码。`identity.register` 本身不查邀请码，供测试和内部直接建账号。

作品标题：用户重命名（`store.rename`）会在作品上记 `named: true`，之后作者运行里的 `write_work.title` 和第一次简报都不再改标题（`writeWork` 返回 `keptTitle`，工具结果里告诉作者），撤销、恢复也保留它。这条规则只出现在工具结果里，不写进系统提示词或工具说明，保持缓存前缀不变。生成图和上传图的 ID 先截断再去首尾连字符；`take` 的 `ID`/`QUOTED` 正则接受 `--`，兼容以前生成的 ID。服务端用 `app.ts` 的 `allowed(c, 权限)` 拦截，管理接口都在 `/api/admin/*`；前端用 `account.tsx` 的 `useCan()` 决定显示什么，但它只是界面，权限以服务端为准。新加权限时要补 `permissions`、`i18n.tsx` 的 `settings.permissions/permissionHints` 中英文，以及服务端拦截。

输入框右下方的 `ModelBar` 只有一个档位按钮（多于一个档位时才出现，纯文字），旁边是剩余提问次数。选了之后前端先用 `chosen()` 乐观显示，再 `PUT /api/settings` 并重新读 `/api/models` 看落定结果。模型名、地址、凭证和价格只在设置中显示。

对没有 `models.manage` 的账号，服务端用 `app.ts` 的 `showRun` 把运行的 `services` 换成只有档位名（`/runs`、开始/回答/取消的返回和 SSE 的 `run` 事件都经过它），运行记录 `/api/traces/*` 只给 `models.manage`，前端也只在有这个权限时显示运行记录入口和账单里的模型名。素材的列表、详情、发布和上传响应统一经 `showMaterial`：没有 `models.manage` 时省去 `origin.model`，素材库里的生成来源仍完整保留。

提问次数：`users.quota`（`Account.quota`，`null` 为不限）。新账号是 `DEFAULT_QUOTA`（10），第一个账号不限；旧库加列时非管理员得 10、管理员不限。`POST /api/works/:id/runs` 先 `spendQuota`（原子地减一，用完时 403“提问次数已用完”），`agent.start` 失败就 `refundQuota` 退回；回答作者的问题（`/runs/:id/answer`）不扣。管理员在设置的“账号”页逐个改（`PATCH /api/admin/accounts/:id` 的 `{quota}`，可与 `role` 分开）。前端用 `user.quota` 显示剩余并在为 0 时禁用发送（等待回答时仍可回答），发出新请求后在本地减一。

首页（`Home.tsx`）是文件页，整页不滚动：标题，“新建”一行（空白画布加三个示例），和“最近的作品”：`/api/works` 按 `updatedAt` 排，`useFits` 量出剩余高度放得下几整行就显示几个（窗口变化时重算），其余由“全部”打开左侧栏；窄于 600px 的窗口（手机）里首页整页滚动、每行两个、输入框贴在底部，`useFits` 看到列表不再 `overflow: hidden` 就显示全部；左侧栏收成左上角一个按钮，点开盖在页面上（`app.module.css` 末尾的“Phones”一节）。列表到达前（`listed`）不显示空状态；没有作品时空状态是一段首次使用的说明（`home.firstSteps`）。注册页在需要邀请码时说明邀请码从哪里来（`auth.inviteHint`）。封面用 `cover`（作者最近一次全图截图，空白作品不用），状态行和左侧栏共用 `Rail.tsx` 的 `progressOf`。左侧栏：首页下方是“新建空白画布”（建一个“未命名画布”并打开，没有简报也能直接手动编辑：`writeWork` 只要求作者的运行先有简报）；最近作品每项在标题下有一行状态，来自 `/api/works` 的 `progress`（`UserStore.progress`：最近一次运行的状态和提问开头、`versionsOf` 算出的当前版本号、是否空白）——正在绘制、等你回答、上次没有画完、已停止，或“第 N 版 · 时间”。收到 `run` 事件时前端先就地改状态，运行结束再重读列表。

绘制模型的可选 `provider` 保存 OpenRouter 提供商标识。设置页的“固定提供商”留空时自动路由，填写后 Responses、Chat Completions 和 Messages 都传 `provider: { only: [标识], allow_fallbacks: false }`；不能切到其他提供商，渠道不可用时返回错误。轮次的 `request.provider` 同样记录这个限制。

模型配置全站共用：`ModelCatalog` 存在 `system` 表，只有 `models.manage` 能读写（`/api/admin/models`）。每个用户自己只存 `UserSettings`（长期偏好和档位），`/api/models`（`ModelMenu`）只给出每个档位的 ID、名称、说明、是否可用（绘制模型已接入且能调工具），以及落定的档位，不给模型、凭证和价格。`UserStore.settings()` 把这两者合成运行要用的 `Settings`，`agent` 和 `images` 只读这个结果。

## 前端的分层

`apps/web/src` 分三层。作品页可以按设备换成完全不同的界面，会话逻辑不用重写：

- **App**：`App.tsx` 管这些：
  - 路由（`routes.ts` 的 `pageOf`/`workIdOf`/`sceneOf`/`addressOf`）；
  - 作品列表、删除与撤销删除、素材库对话框；
  - 正在写的请求（`session/request.ts` 的 `RequestDraft`，一个 store：文字、附件、上传中的数量、主页选的风格、问题的选项；`hand` 把要作者做的修改写进去，并让输入框取得焦点）。请求草稿用 `Store` 的 `immediate` 通知，在输入事件里同步更新 React 的受控输入框；不能延迟到微任务，否则 React 会先恢复旧值并打断输入法组词。请求跨页面存在，因为在素材库里选的素材、主页发出的请求都要带到作品页。附件带着素材各语言的名字，由显示的地方挑。
  - 提示：`feedback.ts` 的 `Feedback` 也是一个 store，记着最近的错误和提示，并按时收起；`SessionError` 的措辞也在这里，供不自己措辞的页面使用。

  App 不读会话的快照（只有 `OpenWork` 读作品到了没有、打开失败没有），所以作者运行时的事件不会让 App 重新渲染。作品页的壳由 `shells.ts` 选出，App 交给它 `ShellProps`（`shell.ts`），只有每种壳都确实需要的四样：
  - `session`：会话本身（store 加动作）；
  - `asking`：`draft`、`send`、打开素材库的 `pick`、档位和 `choose`，以及 `blocked`（没接入模型或提问次数用完；等待回答时仍能回答）。`send` 检查完上传和 `blocked` 后交给会话；在主页没有打开的作品时，`send` 先建作品、用 `begin` 打开，再发出；
  - `feedback`；
  - `go`：去另一个地址。

  这四样在作品页打开期间保持同一个对象（`asking` 只在档位或 `blocked` 变化时更换），注册表又给每个壳包了 `memo`，所以 App 因作品列表等原因重新渲染时，作品页不跟着渲染。账号从 `AccountContext` 读（`useAccount`/`useCan`），没接入模型的提示是 `Composer.tsx` 的 `Unconnected`。
- **会话层** `session/` 不含 JSX、样式和界面文案，不碰 DOM，也不用浏览器存储。`work.ts` 的 `WorkSession` 是一个外部 store，由六个各管一件事、各有自己状态的部分组成，共用一个 `Context`（`types.ts`）：
  - `revisions.ts`：作品与修订。服务器推来的作品比当前的旧就不采用；修订号变了就重取 `/revisions`，预览随之结束。它还记着哪些修订是用户自己的（`own`、在路上的请求），由 `quiet` 回答；`look` 管预览，`rename` 改标题。
  - `runs.ts`：运行与 SSE。自己经 `events.ts` 的 `listen` 订阅，同一用户的所有订阅共用一个连接（各标签页用 Web Locks 选一个去听，经 BroadcastChannel 转给其他页）。手机会冻结不在前台的页面，流会无声地断掉，持锁的后台页还会一直占着锁，所以只有显示着的页面去听：页面隐藏时放下流和锁，重新显示（`visibilitychange`、从往返缓存回来的 `pageshow`、`online`）时重新打开，新流以 `connected` 开头，于是补取错过的东西；服务器每 20 秒发一次 `ping`，`QUIET`（45 秒）内什么都没收到就当流已死、重新打开。SSE 响应带 `X-Accel-Buffering: no` 和 `Cache-Control: no-transform`，前面有代理时也不被攒着发。`offline` 和打开失败的 `unopened` 也在这里；收到 `connected` 时重取作品和运行，用 `merged` 合并。打开作品时先显示作品，运行历史随后合并，`loaded` 之前不能发送、不能手动编辑。`earlier` 是打开作品时已经结束的最后一次运行，它的回复留在画室，不在画布下面重复显示。
  - `edits.ts`：手动修改的队列与草稿（`commit` 返回保存后的作品，`change` 只返回有没有修改）。
  - `sending.ts`：发送与挂起。有排队中或未保存的手动修改时挂起请求，等 `decide("save"|"discard"|"cancel")`；真正发出后调用 `Ask.sent`。请求关于什么由调用方给（`Ask.focus`：选中的模块或连线），`aboutOf` 把它写在请求后面（写给作者的，不是界面文案）。
  - `versions.ts`：保存、放弃、回退（`back` 记着回到第几版或放弃了修改，十秒内可以撤回，此时 `undo` 先撤回回退）、撤销和重做（`undone`）。
  - `scenes.ts`：地址里的场景（`locate`），地址里的场景不存在时换回根场景的地址；`enter(id, asking)` 进入场景，场景还是空的就用壳给的 `asking(标题)` 作为请求请作者画；一次运行只在别的场景画了东西时，结束后跟过去（`follow`）。

  会话只说发生了什么，怎么说、怎么呈现由壳决定：拒绝或做不到时抛 `SessionError`，它的 `reason` 是 `noScene`、`busy`、`linkDrawing` 或 `imagesOnly`；事后要告诉用户的事经 `on(listener)` 发出 `Happening`（`saved` 带版本号；`failed` 是开始后就不再等待的操作失败了）；快照里的 `back` 是结构化的。服务器的错误原样传出，服务端已经按请求的语言翻译好。`SessionHost` 只剩跳转地址、刷新列表、扣提问次数、订阅事件，以及作品内容用的语言（`locale`：从素材库取进作品的名字用哪种语言）。

  动作是会话对象自己的方法（`session.save()` 等，构造时绑定一次）。快照只有数据，`build` 只在被读到时才重建（`Store.changed` 默认标记过期，并在本轮结束时通知一次；请求草稿按上述规则立即通知），没变的字段沿用上一份快照里的同一个对象（`kept`）。组件用 `useSelect(store, 选择器, 比较)` 只读自己显示的那一片，默认按浅比较，选出的值没变就不重新渲染。这一点必须保持：作者运行时每秒会有很多 `run` 事件，低端手机上也要跑得动。`session/work.test.ts` 换上假的 host 和内存里的假服务器，验证草稿、安静替换、挂起、请求附带的选区、回退与撤销、重做、预览、迟到的旧作品、等模块画出再选中、跟随场景、拒绝的理由和发出的事、一轮变化只通知一次且没变的部分保持原对象。
- **会话与画布的边界**是 `View`：会话只用 `center()`、`scale`、`select(ids)` 和 `drawn(ids, revision)`。`Canvas.drawn` 不计时：模块真正画出来（不只是排好位置）就是 `drawn`；画过一个不比 `revision` 旧的版本、里面却没有这些模块，就是 `missing`；画布先没了就是 `gone`。慢设备只是等得久一点，不会误判。壳经 `attach` 把 `Canvas` 交给会话。反方向由画布问会话：`quiet(revision)` 为真就原地安静替换。

  `session/ops.ts` 的 `editOps` 是与设备无关的手动操作，作用于调用方给的模块或连线（删除、复制、排序、编组、对齐、移动、连线、拷贝出 `Clip`、粘贴，放文字、图片或库画法；新文字的内容由调用方给）。它们都经 `edits` 提交；新做出的模块等到 `drawn` 后才选中；失败作为 `failed` 发出。`session/clip.ts` 的 `Clipboard` 记着最后拷贝的内容，存储由调用方注入（`storage.ts` 的 `KeyValue`：`browserStorage` 吃掉浏览器拒绝时的异常，测试用 `memoryStorage`）。
- **壳的选择**：`shells.ts` 的注册表里每个壳一行，`shell(按需加载, 媒体查询, 中英文名, 是否占满屏幕)`。查询只看宽度和 `pointer`，不看 User-Agent；按注册顺序取第一个匹配的，都不匹配时用没有查询的那个（`desktop`）。窗口变化时跟着重新判断（`useShell`）。用户可以在账号菜单里依次换成“自动”或某一种，选择记在 `drawy.shell`；只有一种壳时不显示这个开关。每个壳由 `React.lazy` 单独分包，在 `Suspense` 里加载，并包了 `memo`。

  设备怎么分：
  - `phone`（`PHONE`）：窗口窄于 600px（竖拿的手机，或被拉得很窄的电脑窗口），或者触屏且高度不到 500px（横拿的手机）。
  - 其余都用 `desktop`：平板（短边 600px 以上，竖拿横拿都是）、触屏笔记本和电脑。理由有三：平板放得下画布加一块侧面板；人们在平板上仍会用手指或笔排版；桌面壳里每个操作都有按钮，原来要右键的菜单由画布的长按代替，所以手指也能用。横拿的手机高度太矮，放不下桌面壳的输入框和面板，因此归手机壳。

  `whole` 的壳（手机）占满屏幕：App 在 `.app` 上标 `data-whole`，左侧栏不显示，壳自己的返回按钮回到首页。`index.html` 带 `viewport`（`width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content`），手机才按真实宽度排版，页面本身不缩放（画布自己缩放）。iOS 会在字号小于 16px 的输入框获得焦点时放大页面且不缩回，刷新后还保留，所以 `base.css` 在 `pointer: coarse` 时把所有输入框定为至少 16px；`viewport.ts` 的 `followViewport` 把 `.app` 放进可视视口（`--seen-top`/`--seen-height`，键盘弹出时输入框留在键盘上方，键盘收起后把被 iOS 卷走的页面卷回去），并拦下 Safari 自己的 `gesturestart`/`gesturechange`，双指不会放大整页。`Tooltips` 只认鼠标：手指按下时显示新内容会让 iOS 把这一下当成悬停、吞掉随后的点击。凡是从按钮弹出的菜单都经 `popover.ts` 的 `useDismiss`（按外面或 Esc 关闭），它调用 `@drawy/ui` 的 `useInView`：菜单按自己的 CSS 摆好后量一次，超出可视视口就换到空间大的一侧、沿边滑回、太高就在里面滚动（用 `translate` 和 `max-height` 修正，不管包含块是谁），可视视口变化时重量。`ui` 的 `Menu` 也用它。以后加别的设备：新建一个壳文件（默认导出一个接收 `ShellProps` 的组件），在 `shells` 里 `desktop` 之前登记一行。
- **手机壳** `phone/`：围绕“看和说”设计，不是桌面版缩小，桌面的界面状态和交互习惯都没有搬过来：
  - **页面**：`WorkPage.tsx` 管页面怎么用：选区、打开的底部面板（`SheetKind`）、详情页、收起的回复、就地改字、换图的素材对话框。只读运行开始结束、换场景时才变的东西。
  - **部件**：`parts.tsx` 里的部件各读各的那一片。
    - `TopBar`：返回首页、标题（打开 `ScenesSheet`：改名和场景列表）、撤销、画室与版本、导出分享，按钮都是 44px。画室和版本是同一个底部面板的两个标签（`StudioSheet`/`VersionsSheet` 头部的 `HistoryTabs`），所以回复收起后、重新打开作品后，画室总能从顶栏打开。
    - `PhoneCanvas`：铺满屏幕，`editing` 始终为 false；`controls={false}` 不显示缩放按钮（靠双指）；`resizable={false}` 不显示缩放手柄（调尺寸属于精细排版）。`fill={FILL}`（2）：竖拿手机时，宽的图整幅放下字太小，自动视角最多放大到整幅的两倍去铺满屏幕，从图的左上（阅读开始处）摆起；`Whole` 在视图没有放下整幅图时（`Canvas.showsWhole`）浮在底部右上方，点它 `fit(…, "whole")` 看全图。
    - `Notes`：预览、错误、回退可撤销、挂起与未保存修改，按钮横排可换行。
    - `Actions`：选中一个模块时，在输入框上方出现改字（模块有画出的字时）、换图（模块数据引用了图片素材时，`picturesIn`）、说说怎么改、删除；名字和取消选择在上面一行，名字再长也不会把取消选择挤出屏幕。
    - `Status`/`PhoneComposer`：作者作画时输入框收起成进度条。画室不自动打开，因为手机上画布才是要看的；点进度行从底部拉出 `StudioSheet`。
    - `VersionsSheet`：点一个版本就收起面板、在画布上原地预览，预览条里可回到这一版。
    - `Sheet`：底部面板，点暗处、关闭按钮或按住把手和头部往下拉（超过 `PULLED` 或快速一甩）都会关上；从标签或按钮上开始的拖动也算拉，不算点。标题过长时省略。
    - `back.ts` 的 `useBackCloses`：打开的面板和详情页各占一步浏览历史（同一地址），浏览器的返回（或从屏幕边缘右滑）先关上它们，不离开作品；用自己的按钮关上时把这一步还回去。详情页的“返回图中”（`runtime/detail.ts`）滚动时贴在顶部。
    - `ShareSheet`：用 `Export.tsx` 的 `useExports`/`ExportItems`，系统分享排第一。
  - **手势**：点一下选中，有跳转目标的模块点一下就进入、长按只选中；选中的模块直接用手指拖动（会话的 `ops.move`）；双击文字就地改字。没有一样操作需要右键、修饰键、悬停或快捷键。超出这些入口的修改用“说说怎么改”带着选中的部分交给作者。
  - **样式**：`phone.module.css` 用 `base.css` 的 token：白纸、中性灰、唯一的蓝、轻阴影、8～12px 圆角，不用毛玻璃，动效只在用户打开面板时出现。`phone/cx.ts` 只解析手机的样式表和共享的 `vocabulary`，不带桌面的 `app.module.css`，以免同名类把桌面布局带进来；要用桌面样式表里的个别类（如 `now`）时显式用 `../cx.ts`。横拿时输入框和面板保持适合阅读的宽度，安全区由 `env(safe-area-inset-*)` 让开。
- **桌面壳** `desktop/`：
  - `WorkPage.tsx` 管页面怎么用：选区和连线选择、详情页、收起回复、面板（画室、版本、编辑）及其宽度（`panels.tsx`）、作者开始运行时自动打开画室、场景菜单、改标题、就地改字（`Retype`）、换图时的素材对话框、画室跟着滚动、会话发出的事怎么说（`saved` 说成“已保存为第 N 版”，`failed` 交给 `feedback`），以及 ⌘Z/⇧⌘Z、⌘S 和 Esc（结束预览、收起回复）。它从会话只读运行开始或结束、换场景时才变的东西，快捷键在按下时才读会话。
  - `parts.tsx` 是读各自那片快照的部件：`Topbar`、`CanvasArea`、`EditOverlay`、`Status`、`Bars`、`DockComposer`（自己读请求，所以打字只重新渲染它）、`DetailLayer`、`SideTools`、`StudioPane`、`DraftsPane`、`EditPane`。作者运行时，只有画布、状态行和画室会跟着重新渲染。
  - `editing.ts` 的 `useEditing` 是鼠标和键盘的编辑方式：工具、右键菜单、系统剪贴板事件、编辑快捷键、方向键微调、全选和 Tab 轮选。它把会话的 `ops` 绑到当前选区上，再加上要先选素材的 `add(kind)`；桌面的剪贴板是这里的一个 `Clipboard(browserStorage)`，所有作品共用。
- **作品页的回归验证** `apps/web/regression/`：`harness.ts` 在临时目录里起真实的素材服务和主程序（各用一个空闲端口），用 Playwright 打开构建出的前端。它导出的 `page`、`asked` 等是活绑定，每条用例拿到的都是为它新开的页面。手指经 CDP 的 `Input.dispatchTouchEvent` 按下，也就是浏览器自己的触屏输入：`fingers`、`swipe`、`pinch`、`press`、`tap`。作者不是真的：请求被拦下，回一个已结束的运行；作者的运行事件经页面收事件的 BroadcastChannel 发给页面，和服务器推来的事件走同一条路；档位菜单显示为已接入。部件经 `probe.ts` 的 `counted` 计数，只在测试设置了 `window.__drawyRenders` 时计数。布局对不代表画出来对，所以 `paintedAsLaidOut` 看像素：先截整屏，再量文字的布局框，要求截图里模块内深色像素的范围落在布局框里、并铺满它的大部分宽度（字画大了会溢出，被裁掉会留空）；必须先截图，因为命中测试（`elementFromPoint`）会让浏览器重新排版文字，把用户看到的错误盖掉。`outlined` 数画布上选中框的个数。三个套件：
  - `desktop.test.ts`（电脑屏幕、鼠标和键盘）：
    - 画法里的 SVG 文字按布局的大小画出；
    - 手动修改先以草稿显示，保存后原地替换、模块元素不重建；
    - 有未保存修改时挂起请求（取消、保存后发送并附上选区）；
    - ⌘Z/⇧⌘Z/⌘S；打开版本面板时放开选区，预览和回到某版都不重画，回退和放弃修改都可撤销；
    - 空白画布放文字后直接就地改字，⌘D、⌘C/⌘V、Delete；
    - 主页发请求建作品；进入空的子场景时请作者画，地址里没有的场景回到根场景；
    - 作者运行时自动打开画室、收起输入框，结束后的回复按 Esc 收起；运行只画了子场景时跟过去；打开前已结束的回复留在画室；
    - 作者运行事件只让画布和状态行重新渲染，打字只让输入框重新渲染；
    - 桌面页按需加载、单独分包。
  - `phone.test.ts`（模拟 iPhone，手指）：
    - 铺满屏幕、没有侧栏，窗口变成平板大小时换成桌面页、再变回来时换回；
    - 发请求，作者作画时画布不被遮挡，从进度行拉出画室，回复可收起；
    - 点选后出现的操作，以及带着选区“说说怎么改”；
    - 手指拖动选中的模块，原地替换并保存成新版本；
    - 双击就地改字，删除；
    - 长按选中有跳转目标的模块而不进入，点一下才进入；
    - 单指在纸上平移、双指缩放；
    - 竖拿、横拿和双指缩放后，画法里的 SVG 文字按布局的大小画出、不被截断；
    - 打开版本面板时放开选中的部分，预览、回到此版并撤销；顶栏撤销；
    - 挂起请求；标题面板改名、进入场景；导出面板；
    - 运行事件和打字时只重新渲染对应部件；手机页单独加载；
    - 宽图打开时从左边铺满屏幕、字够大，点“看全图”看到整幅，双指缩放后按钮再出现；
    - 回复收起后从顶栏打开画室；底部面板下拉关闭，浏览器返回关面板而不离开作品；详情页滚动后返回仍在顶部，浏览器返回关掉它；
    - 很长的模块名不挤掉取消选择；输入框至少 16px；长回复只显示前两行；
    - 页面隐藏期间的变化在重新显示后补上；首页整页滚动到所有作品、菜单在屏幕里打开。
  - `tablet.test.ts`（模拟 iPad Mini）：平板竖拿横拿都是桌面页，文字按布局的大小画出；编辑时单指拖动模块、在纸上平移而不是框选、长按弹出编辑菜单、手柄有指尖大小；双击改字；双指缩放。

  改会话层、画布或接入新壳后跑 `pnpm test:desktop`（三个套件都跑），就能知道各个页面有没有被改坏。新增作品页行为时，在对应套件里补一条用例。

新的会话行为写进对应的部分并在 `work.test.ts` 里测，不要放回组件的 ref 和 effect 里；界面怎么呈现的状态和文案放在壳里。

## 手动编辑如何流动

原则：手动编辑的能力等于作者 `write_work` 的能力，不多也不少。每个手动操作都算出一份只含变化的 `WorkEdit`，经 `POST /api/works/:id/edits`（`{baseRevision, edit}`）交给 `writeWork`，和作者的写入是同一种写法、同一套校验，落到作品上是同一个 `layOn`。所以协议里没有的东西（旋转、透明度、锁定之类）手动编辑也不能有；要加这类能力，得先改协议，让作者同时拥有。反过来，作者能写的（模块的名字、位置、编组、跳转目标和数据，连线及其两端，场景及其脚本，详情，作品画法的代码、默认值与参数，共享样式，取用素材），手动编辑都有入口。`set_brief`、`generate_images` 和 `view_canvas` 是作者的创作工具，不是对作品的修改，不进编辑器。

用户在绘图页点铅笔（或双击画上的文字）进入编辑模式，右侧面板换成 `apps/web/src/Editor.tsx`，画布上方出现工具条（`EditMenu.tsx` 的 `EditTools`：选择 V、平移 H、文字 T，以及添加图片和库画法），选中内容上方浮着 `SelectionBar`（复制、置顶、置底、编组/解组、说说怎么改（把选中的部分带进输入框）、删除；选中连线时是调转、说说怎么改、删除），它经 `Canvas.watch` 跟着视角和选区移动、按 `selectionRect` 定位，拖动时（`Canvas.dragging`）、右键菜单打开或就地改字时隐藏。面板分“属性”和“图层”两页：属性页选中模块时，顶部吸附着名称、画法名和一排图标操作（复制、编组/解组、置顶、置底、说说怎么改、删除），下面依次是位置与大小（X/Y/宽/高，可锁比例，多选按整体换算；字母可左右拖动调整，拖动中经 `Canvas.reshape` 预览）和对齐分布、内容（`EditControls.tsx` 的 `Fields` 加 `DataEditor`）、点击后（不跳转、某个场景或详情，或当场新建子场景/详情）、连线（每条一行，点一行即 `canvas.selectLink` 选中它，行内可调转、删除）和折叠的“画法与代码”（`EditCode.tsx`：换画法、库画法复制为作品画法、共用画法只改这一个、画法代码与参数、整条模块记录的 JSON）；选中连线时是 `LinkPanel`：两端各一个模块下拉框和边的分段选择（换模块时取朝向另一端的边）、调转、选中两端模块、内容（同样的 `Fields`/`DataEditor`）和连线画法（场景里连线用过的画法和库里的 `arrow`，从素材库选的必须是 `use: "link"`）；没选中时是添加、一句说明、场景（标题、子场景、交互脚本、删除场景）、作品外观（所有样式 token，加套用库风格的配色）、详情页和快捷键与手势（`EditWork.tsx`）。选中的东西变了面板回到顶部。图层页按上下层列出模块，可点选、Shift 加选、双击改名、拖动改层级，下面列出场景的连线，点选即选中。面板控件不按版本重建（`Fields`、`DataEditor` 只按部件 ID 作 key），保存不会打断正在输入的下一项：文字框、滑块在没被使用时才跟上作品里的新值，数据编辑器的一项被别处改了（撤销、作者）才从新值重来，自己保存回来的不算。选项超过五个用下拉框，少的并排、放不下换行。代码类输入（`Code`）在保存前用 `syntaxError` 检查语法，记录类输入用 `contracts` 的 schema 校验。

画布（`modules/canvas`）在 `Canvas.setEditing(true)` 时于捕获阶段接住点击，画法里的按钮和模块的跳转目标都不响应。编辑模式下按下的位置由 `pick` 决定：先是在那里真正画了东西的模块，再是经过附近（屏幕 10px 内）的连线，最后是框住这一点的最小模块；连线画在底图之上，所以按在底图上、连线附近的点选中连线（`beneath`），铺在底下的大模块不会挡住它上面的连线。连线的命中按它画出来的样子算：`traceOf` 把连线影子 DOM 里每个 SVG 几何元素沿路径取样、文字取外框，换成场景坐标缓存到连线重画为止，HTML 画的连线退回两端间的直线。悬停的连线和选中的连线都描一层半透明的强调色；选中连线（`selectLink`，与模块选区互斥，变化经 `options.selectLink` 告诉前端）时两端出现圆点（`data-link-end`），拖到某个模块上调用 `options.reconnect`（不能接到另一端所在的模块），拖动时虚线吸到目标边的中点上并画一个圈。其余手势：单击选中，Shift 加选，拖空白处框选（触到即选）；任何模块按下即可拖动，编组的模块带着整组走（Alt 只动自己），Shift 锁定水平或垂直；拖动和自由缩放时边缘与中线吸附到其他模块（`editing` 的 `snap`，屏幕上 6px 内，红色参考线，按住 ⌘/Ctrl 不吸附），选区下方显示位置或尺寸；选区外框有 8 个手柄（`resized`：Shift 保持比例、Alt 从中心），多选时按 `scaled` 整体缩放；手柄和圆点是比画出来的标记大得多的透明按钮，好按；单选时四边外各有一个圆点，拖到另一个模块上调用 `options.connect`，由 `facing` 定终点的边，同样标出目标边；右键先让选区（模块或连线）跟上再调用 `options.menu`（前端的 `EditMenu`）；按住空格、中键或平移工具拖动平移，放置工具和双击空白处调用 `options.place`；双击按坐标找到模块影子 DOM 里的文字或图片，交给 `options.point`，双击连线上的字也交给它（`link: true`，`moduleId` 是连线 ID）；`wordsIn` 给出模块画出的第一段文字，供 Enter 就地改字。拖动和缩放时模块先由 `SceneRenderer.position` 立即放到新位置（缩放先拉伸外框），需要重画的部分（改了尺寸的模块、连到它们的连线）每帧最多画一次、总用最新的位置（`drag`），松手时提交手势记下的最终位置；`SceneRenderer.move` 只重画连到被移动模块的连线。

触屏手势是画布自己的能力，所有壳都有。画布带 `touch-action: none`，所以浏览器不会拿手指去滚动或缩放页面。指针事件按 `pointerType` 区分手指和鼠标：
- 每根手指的位置记在 `touches` 里；第二根手指落下（落在画法里的按钮上也算）时，第一根手指开始的手势作废（拖动中的模块回到原位），换成 `pinch`：两指的中点带着视角走，两指间距按比例缩放（`zoom`）。抬起一根手指就结束，剩下那根不再起作用。单指手势只认开始它的那根手指（`gesture.pointer`）。
- 单指在模块上的效果和鼠标一样（选中、拖动选中的或编辑中的模块）；在纸上总是平移视图，编辑时也一样（框选留给鼠标）。
- 手指不动按住 `HOLD_MS`（500ms）是长按：先让选区跟上手指下的东西，再调用 `options.hold`；没有提供 `hold` 时，编辑中就调用 `options.menu`，相当于右键。之后浏览器自己发出的 `contextmenu` 被拦下。
- 两次点按相隔 `DOUBLE_TAP_MS` 以内、距离 `DOUBLE_TAP_PX` 以内，算双击，走 `dblclick` 的逻辑；随后浏览器补发的 `dblclick` 不再处理（`doubledJustNow`）。手指双击到模块上没有字的地方时，改它画出的第一段字（`wordsIn`），因为指尖盖住的不止一个点。
- 手指移动 `FINGER_STILL`（8px）以内仍算按住，连线命中范围是 `FINGER_SLOP`（24px）。
- 设备有粗指针（`any-pointer: coarse`）时，缩放手柄、连线圆点和连线端点的可按范围都是 44px。
- `resizable: false` 去掉缩放手柄，选中的模块仍可拖动。

桌面壳 `useEditing` 的 `ops`（会话的 `ops` 绑到选区，加上 `add`）是前端唯一的操作集合：面板、右键菜单、工具条、浮动操作条和键盘都调用它；`remove` 在没选模块时删选中的连线，`reverse`、`reconnect` 作用于连线。剪贴板走系统的 `copy`/`cut`/`paste` 事件：拷贝时写入 `application/x-drawy+json` 的 `Clip`（`editing` 的 `copy`：模块、它们之间的连线、用到的作品画法和库画法，以及素材 ID），同时存进 `Clipboard`（桌面用 `browserStorage`），所以能粘贴到别的场景、作品或标签页；粘贴回原处时每次错开一步，粘到别处时放在视图中央；剪贴板里是图片就上传后作为图片模块放进来，是文字就作为文字模块。快捷键：⌘A 全选、Tab 轮选、⌘D 复制、⌘G/⇧⌘G 编组/解组、⌘]/⌘[ 置顶/置底（加 Alt 为一层）、Alt+A/D/W/S/H/V 对齐、Alt+Shift+H/V 等距分布、方向键微调、Delete 删除（选中连线时删连线，⌘X 也是）、Enter 就地改选中模块的字、R 调转选中的连线、Esc 取消。选中连线时发给作者的请求附上 `Selected link: <id> (<起点模块> → <终点模块>)`。

每个操作都是 `modules/editing` 里的纯函数（按职责分文件：`fields`、`parts`、`layout`、`links`、`words`、`clipboard`、`work`、`changes`），从当前作品算出一份 `WorkEdit`（`apply.ts` 的 `applied` 把它叠到作品上，和 `writeWork` 用的是同一个 `layOn`；两步合成一步用 `composed`）：`setData`、`moveParts`、`rename`、`removeParts`（连带删掉相关连线和检查）、`duplicate`（复制品自成一组，并复制它们之间的连线）、`arrange`（置顶、置底、上移或下移一层：越过下一个与它重叠的模块）、`restack`、`group`/`ungroup`、`setTarget`、`useDrawing`、`setModule`、`add`（文字、图片或库画法，库画法带它的示例数据和尺寸）、`align`/`distribute`、`connect`（连到两个模块的边上，不动模块；新连线沿用场景里最近一条连线的画法和数据，`linkLook`，没有时用库里的 `arrow`）、`reattach`（换一端所在的边，不给边就回到自动跟随，给了模块 ID 就换到那个模块上，不能接到另一端所在的模块）/`reverse`、`replace`（给的是连线 ID 时只改连线数据里的字或图片）、`paste`（新 ID；同 ID 而代码不同的作品画法换新 ID；剪贴板也带着用到的库画法，目标作品有同 ID 的自带画法时，库画法连同默认值以新 ID 作为作品画法放进去；目标作品没有的跳转目标置空）、`setStyle`/`setStyles`、`addScene`/`renameScene`/`removeScene`（连同下面的子场景，指向它们的模块不再跳转）、`setDetail`/`removeDetail`、`setInteraction`、`setDrawing`、`fork`。`replace` 先在模块数据里找要改的字或图片 ID（改的若是某一项的 `name`，数据里所有与它完全相同的字串一起改，比如地图的路线、区域、`highlights` 按地点名引用它，只改一处路线就会丢掉这个点）；找不到时，如果它在画法代码里只出现一次，就按所在位置转义后替换，画法被别的模块共用时先为这个模块复制一份，替换后代码必须还能解析；都不行就返回 `null`，前端把修改要求写进输入框交给作者。`fieldsOf` 决定面板显示哪些普通控件：先是画法 `params` 声明的（名字可写可不写，没写时来自 `i18n.tsx` 的 `edit.params`），再是画法 `defaults` 和数据里其余的文字、颜色、数字和开关；小写的英文单词当作代码里的状态，不显示。其余的数据（列表、记录、状态词，`restOf`）进数据编辑器：列表可增删、上下移动（新增一项是复制最后一项），记录可增删字段。

会话的 `edits` 把这些修改排成队，依次从上一次结果出发，服务端把原因记为 `{ kind: "edit" }`（未保存的修改，见上文 `historyOf`），作者运行期间返回 409。修改不等服务器回应就显示：`commit` 先在“排队修改都完成后的作品”（`drafted`）上算一次，`showable` 时用 `applied` 得到草稿交给画布和面板（`SceneView` 的 `version` 区分同一版本号的不同显示），队列清空时换回服务器的作品，任何一次失败都丢掉草稿；要取用作品还没有的素材的修改（换图、新库画法，包括模块或新连线用到作品还没取过的库画法，比如空白画布上的第一个文字）等服务器取到素材再显示（`showable`）。所以 `make` 可能被调用两次（草稿一次、提交一次），里面不要放只能执行一次的副作用。用户自己造成的版本（手动编辑、撤销、重做）在画布上安静替换，不播放起稿动画：`SceneView` 问会话的 `quiet`，再调用 `Canvas.update(…, quiet)`； `SceneRenderer.patchable`（同一场景、样式和交互脚本没变、两边都有的素材没变）时调用 `patch` 原地更新，只重画画法、数据或尺寸变了的模块，移动的只改位置，删掉的拿走，新的画上，按新顺序调整层级，连线全部重画；其他情况才另起一个渲染器整体替换。重做只在撤销后作品没有别的变动时可用，记录在会话里（`undone`）。下次作者运行时，`changesBetween` 列出的不只是场景里模块的增删改移和层级，还有场景本身的标题、父场景、脚本和交互检查清单，整个新增或删除的场景，以及画法、详情的增删改，提示词要求作者保留。

## 模块职责

`modules/` 下各模块之间用相对路径（`../x/index.ts`）互相引用。

- `contracts`：作品协议（`Work`、`Scene`、`Instance`、`Link`、`Drawing`、`Brief`、`WorkEdit`）、运行记录（`Run`、`Step`、`ToolActivity`）和设置。前后端、运行时和作者工具共用这一份 schema，它是协议的唯一来源。
- `workspace`：`createWork`、`writeWork`、`setBrief`、`restore`、`undo`，以及 `validateWork`。
- `editing`：把手动操作变成 `WorkEdit` 的纯函数、面板控件的推断（`fieldsOf`/`restOf`）、拖动与缩放的几何（`snap`、`resized`、`scaled`）、剪贴板（`copy`/`paste`），以及两个版本之间的差别（`changesBetween`）。前后端和画布都用，不依赖存储和素材库。
- `runtime`：画法执行环境，`SceneRenderer` 另外维护连线的当前副本（`links`，供预览和命中），并能把同一场景的新版本原地叠上（`patch`）。连线画在模块之下（zIndex：底图 0、连线 1、其余模块 2），但场景最底层、覆盖整幅图九成以上的模块是底图（`backdropOf`），连线画在它之上；移动和重排后由 `relayer` 重算。画法接收 `api`（`svg/html/mermaid/material/materials/draw/effect/emit`，连线另有 `from/to/fromSide/toSide`），交互脚本使用 `on/set/move/openScene/openDetail/animate/cleanup`。打包入口是 `browser.ts`，`scene.ts` 负责场景，`fixture.ts` 供测试使用。
- `agent`：运行循环与重试（`index.ts`）、工具 schema（`tools.ts`）、系统提示词与素材目录（`prompts.ts`），以及解析流式到达的工具参数（`partial.ts`）。
- 搜索方式为 `builtin` 的创作轮次在自定义工具旁提供 OpenAI 内置 `web_search`（`search_context_size: "low"`）；搜索由 OpenAI 执行，`web_search_call` 随其他输出原样进入后续上下文和 trace，不走本地工具执行器。运行步骤记录搜索查询或页面 URL；消息保留 `url_citation` 的位置、标题和链接，前端在原文位置显示可点击来源。OAuth、Chat Completions 和上下文压缩不添加内置搜索工具；Anthropic 接口的内置搜索由 Claude 执行，见上文。
- `models`：用 OpenAI Responses 的项和事件调用创作模型，每种接口格式一个适配器（`responses.ts`、`chat.ts`、`anthropic.ts`），并负责缓存键；`headers` 也供生图使用。
- `search`：独立搜索服务的客户端（`searchWeb`、`readPage`），每个服务商一项 `Client`。
- `observation`：截图服务的客户端。`capture.ts` 在截图容器里运行，运行时测试也直接调用它。
- `images`：按作品风格生成图片，并把结果回报给作者。风格参考图由 `styleReferences` 选出，记在素材的 `origin.styleReferences`；生成图一律是该用户的私人素材。抠图角色（object、figure、icon）显影时带 `transparent`，素材库量出没有透明区域就返回 422、不保存，`develop` 用同一提示词再画一次（两次返回图片的张数和 token 都计入，重试失败也保留第一次的用量）；第二次仍不透明就照存，结果带 `opaque`，作者在 `Pictures:` 消息里被告知它会显示成方框。
- `materials`：主程序访问素材服务的一层，只经 `@drawy/materials/client` 访问，不直接读素材库的数据库。
- `canvas`：前端画布，负责视角、选择（含多选）、移动、缩放、编辑模式和起稿动画（`ink.ts`）。自动视角（`fit`）按 `framing` 摆：`fill` 选项允许时铺满屏幕（短边放下、长边从左上开始越出屏幕），`fit(…, "whole")` 之后一直放下整幅；`showsWhole()` 说视图里是否放得下整幅图（除去 `insets`）。`geometry.ts` 的 `fit` 在小屏幕上边距最多 64px、按比例收小，不再固定留 64px。第一次挂载（打开作品、进入子场景）不播放落笔动画，只有之后 `update` 换上的新版本才落笔。不在编辑时，带跳转目标的模块右上角叠一枚小标记（`paintTargets`，放在画布自己的覆盖层里、样式在前端的 CSS 里；运行时页面用同一个 `Canvas`，所以 `browser.ts` 传 `marks: false` 关掉它，截图服务和导出都看不到它），鼠标在模块上时（`hot`）展开写明去处，点它也能打开。`drawn(ids, revision)` 等指定模块画出来，或者确定画不出来（见“前端的分层”），会话靠它选中新做出的模块。手指的手势（双指缩放平移、单指拖动、长按、双击）见“手动编辑如何流动”。画布尺寸变化（面板展开、窗口缩放）时保持画面中心，自动视角在停下 200ms 后平滑适应一次；`fit` 在目标与当前视角几乎相同时不动，避免小幅滑动。Chromium 排 SVG 文字时把屏幕上的缩放算进字体；图层正在做不透明度、滤镜这类动画时它被合成，视角的 `transform` 交给合成器直接改，文字不再重排，于是按旧的缩放画出（大一倍、被裁到布局框里），直到命中测试或重画才恢复。所以运行时给画法的 SVG（`scene.ts` 影子样式里的 `svg`）和画布自己的草图标签都设 `text-rendering: geometricPrecision`，让字体不随屏幕缩放；打开场景时也先定视角再淡入。不要去掉它们。
- `storage`、`identity`：按用户隔离的 `data/drawy.sqlite`，以及账号、角色权限和全站模型配置。`UserStore.viewer`（`{ id, all }`，`all` 来自 `materials.all`）是访问素材库读接口时代表用户的身份，读素材一律传它；写入（预留、显影、上传、记录使用）仍传 `userId`。
- `trace`：基于 AsyncLocalStorage 嵌套记录，任何模块都可以直接调用 `tracer`，不需要层层传参。每个 span 另存一份 `brief`（时间、状态、用量、计量键和几个字的摘要，`spans` 表的 `brief` 列，旧记录在第一次读取时补上）：列表、汇总和时间线（`/api/traces/:id`）只读它，展开某一步时才由 `whole` 经 `/api/traces/:id/spans/:span` 取完整记录，模型轮次连同服务端拼好的完整输入。不要让列表或时间线重新读取完整 span，那会把整段对话读出来。
- `ui`：共享的 React 组件和品牌素材。

`materials/` 是独立的素材包和服务，有自己的 SQLite、文件和检索。素材严格分公共（`owner: null`：策展素材和被发布的图片）和私人（`owner` 是用户 ID：上传和生成的图片一律如此）。素材服务按请求头识别身份：`x-drawy-user` 是用户，`x-drawy-access: all` 表示可看所有人的素材（由主程序按 `materials.all` 加，客户端用 `viewerHeaders`/`Viewer` 生成）。`browse` 的 `shelf`（`public`/`mine`/`others`，最后一种要求 `all`）把素材分栏；`publish` 把用户的图片设为公共或还给 `origin.user`，策展素材不能改；`styles()` 的样张和计数只取公共图片，私人图片不会通过风格露给别人。作者的 `find_materials` 只传用户 ID，不带 `all`，所以作者只在公共素材和本人素材里检索；管理员要用别人的素材时从素材库附加，`take` 用 `viewer` 读取。素材分四种：`picture`、`drawing`、`effect`、`style`。策展素材在 `materials/seed`：画法源码在 `seed/drawings/<id>.js`，元数据和示例数据在 `drawings.json`，图片在 `seed/files`。所有素材共用一个 ID 空间，新画法的 ID 不能和图片重名（比如已有图片 `tree`，层级树画法叫 `hierarchy`）。结构图与图表画法（`node`、`hierarchy`、`layers`、`quadrant`、`compare`、`pyramid`、`venn`、`mindmap`、`steps`、`swimlanes`、`fishbone`、`sequence`、`concentric`、`gantt`、`bars`、`donut`、`gauge`、`stat`、`radar`、`checklist`、`callout`）只用风格 token 上色、可选 `effect` 参数套质感（所以数据里别用 `effect` 当别的字段名）；新加的参数名要在 `i18n.tsx` 的 `edit.params`、选项值在 `edit.options` 补上中英文；画法读取的每个 `d.xxx` 都要在 `params` 里声明，否则卡片和手动编辑都不知道它（`materials.test.ts` 检查这两条）；`runtime.test.ts` 会用示例数据把每个库画法都画一遍，再用大字号画一遍，新画法要在那里能无错画出、文字不被裁切。地图画法 `geomap` 把经纬度投影到真实的海岸线、湖泊、河流和（可选）国界、一级行政区界上。数据在 `seed/geo`：`physical`（总览用的 1:5000 万陆地湖泊与 1:1000 万河流）、`countries`、`subdivisions`，以及近景用的 `detail-<列>-<行>`（1:1000 万陆地、湖泊和岸线，按 15° 分块、精确到千分之一度，缩放级别 ≥ 4.5 时画法只读视图覆盖的几块；块内填色在块边被切开，所以不描边，岸线单独成线）。坐标存成差分整数，单位是 1/scale 度（默认百分之一度，分块文件自带 `scale`）。由 `pnpm --dir materials geo` 从 Natural Earth 重新生成（`materials/geo.ts`，用 npx 跑 mapshaper，不是依赖）。政治图层只有一个视角（`view`，目前是 Natural Earth 的中国视角）：地图单元、每条边界在该视角下的分类（`FCLASS_<视角>`，不承认的线丢弃）、海上界线、一级行政区归属都按它来。规则对所有国家相同，画法和构建脚本里都不写任何具体国家：行政区裁到它所属单元在该视角下的领土；主权属于别国的单元整体算一个行政区；视角下不存在的单元并入包含它的单元。国名取 CLDR 简称（`Intl.DisplayNames`）。由素材服务的 `/geo/:layer` 提供、主程序经 `/materials/geo/` 转发，画法运行时按需 fetch 并缓存在页面里（读取以任何方式失败都会从缓存里删掉，下次绘制会重试），所以不进作品的素材快照；`runtime.test.ts` 的测试服务器也要提供这条路由。作品快照的是画法代码，地理数据却是在线读取的：作品每次写入会把库画法刷新到当前版本（`materials` 的 `take`），但没再写入的旧作品仍跑旧代码，所以改 `seed/geo` 的文件格式或图层名时，要让旧版画法仍能读到它期待的东西，或者换一个新的图层名。作者提示词要求不按位置挑库画法输出里的元素来改（库更新后顺序会变），所以作者需要的能力要做成参数，例如按名称突出河流的 `highlights`、边界颜色 `borderColor`。地势晕渲在 `seed/geo/relief`：由 `pnpm --dir materials relief`（`materials/relief.ts`，可用 `NE_RASTERS` 指向已解压的 SR_50M/SR_HR 免得重新下载）从 Natural Earth 的晕渲栅格切成三级经纬度方块（每度 6/30/60 像素，块大小 180°/30°/15°，只留有起伏的块），索引是 `relief.json`（`flat` 是平地和海面的灰度 206），图块经 `/geo/relief/<级>-<列>-<行>` 以 WebP 提供。画法按视图每度像素数选级，把图块画进一张经纬度画布，再对地图的每个像素逆投影取样，比平地暗的画成墨色阴影、亮的画成纸色高光，所以任何投影都适用；缩放级别 7 起渐隐、到 10 消失，在 OpenStreetMap 底图下铺在陆地上、公园水面道路之下，参数 `relief` 可关。投影有两种：经度跨度不到 150° 用按中纬度余弦压缩的等距圆柱，否则用以视图中央经线为中心的 Natural Earth 投影，这时数据线和多边形按中央经线 ±180° 裁开并加密（`pieces`），海面画成地球轮廓加 30° 经纬网，没有比例尺和外框；画法里取坐标一律经 `px`/`unproject`，不要再按线性换算。线条分层：国界是浅色宽带上一条细实线（争议界虚线），省界只画在“主题国家”境内，河流用水色，海岸向海一侧有晕染，线宽在世界和大洲尺度按缩放级别变细。主题国家（`focus`）是地点、路线、区域所在的国家，没有时取视图中心所在国家：只标它们的一级行政区名，其余国家只标国名；国名字号随国家在图上的大小变化，同名只标一次，数据里没有外形框的小单元（礁、小岛）不标。Natural Earth 最细只有 1:1000 万，城市里什么都没有，所以缩放级别 ≥ 7（视图两百公里左右以内）时底图改用 OpenStreetMap 矢量瓦片（OpenMapTiles 结构，默认取 OpenFreeMap 的免 Key 服务，`DRAWY_TILES_URL` 可换成别的 TileJSON 或 `{z}/{x}/{y}` 模板）：素材服务的 `/geo/streets/:z/:x/:y`（`materials/streets.ts`）取瓦片、只留水面、绿地（林地草地和城市公园，不含整片的国家公园和保护区）、水道、按等级分的道路、铁路和水道与主干道名称（只取 OSM 的 `name`，即当地写法，不分语言；要换成读者的语言由作者看图后填 `names` 参数 `{原名: 显示名}`，它替换地图从数据里取来的所有名字，国名、省名、河名、路名都算，`highlights` 用原名或显示名都能找到河），存成以瓦片单位差分编码的 JSON，缓存在素材数据目录的 `streets/<数据源哈希>/` 下（按 `DRAWY_TILES_URL` 分目录，换了数据源不会混用两家的瓦片；文件名带格式版本 `FORMAT`，改了取舍规则就加一，旧缓存自然失效），每块只取一次；所以素材服务需要外网（compose 里与主程序共用 `DRAWY_OUTBOUND_PROXY`）。画法按视图取 `min(14, floor(zoom))` 级的瓦片（最多 36 块），每块裁在自己的方格里画，块边被切开的形状就不会露出来；道路按等级随缩放出现（高速 7、国道 7.5、省道 9、县道 11、更小 12～13.5），铁路从 9 起；这一层下不再画 Natural Earth 的陆地、湖泊和河流，国界省界仍用 Natural Earth 的（政治视角统一），`highlights` 也会按名称找瓦片里的水道。有任何一块读取失败时整张图退回 Natural Earth 并在图上写明街道底图读取失败；画了街道就在角上署名 © OpenStreetMap（ODbL 的要求）。参数 `roads` 关掉道路和铁路（历史地图用，OSM 的海岸、水面和林地照旧，不会退回 Natural Earth 的粗海岸），`roadNames` 关掉路名。`materials/fixtures` 里有一块广州市中心的真实瓦片，素材和运行时测试都用它，不连外网。自动取景在多个地点时最小只留 0.02°，一个城市里的路线不会被放大成整个地区。画法里的通用规则：河流按 Natural Earth 的 `min_zoom` 随比例出现；区域名只在放得进区域时标出，标注点不在视图内或被占时在区域可见部分里找空位；某国的行政区名已标出就不再标国名；路线和区域按“每段走短的一侧”展开，数据线在与视图相交的每份世界副本上都画，跨 180° 经线不断开。`apps/web` 是 React 19 前端，用 CSS Modules 写样式，图标用 lucide-react。

## 改动时需要知道的约束

**协议改动要沿整条链同步。** 先改 `contracts`，然后检查这些地方：
- `workspace` 的校验和作者读到的写法 `workspace/author.ts`；
- `editing/apply.ts` 的 `layOn` 和 `composed`；
- `modules/storage/upgrade.ts`：改了已保存作品的形状，就把 `WORK_FORMAT` 加一并写升级，`Storage.upgradeWorks` 启动时先备份到 `backups/`，一个事务里升级 `works` 和 `revisions`，失败就回滚并拒绝启动；同时加 `agent/index.ts` 的 `CONTEXT_FORMAT`，旧对话不再续用，只带上用户说过的话和完整作品重新开始；
- `runtime` 的读取；
- `agent/tools.ts` 的工具 schema；
- `agent/prompts.ts` 里对作者的说明；
- `partial.ts` 的流式解析；
- `editing` 的手动编辑和编辑面板；
- 前端的调用方；
- 相关测试。

这样做的原因是，作者只能通过 schema 和提示词知道协议长什么样，任何一处没跟上，模型就会写出无效的作品。画法参数的类型（`contracts` 的 `paramTypes`）也是素材库 `Param` 的可编辑类型，两边一起改。`instanceSchema` 和 `workEditSchema` 的模块里布局字段排在内容字段前面，这是有意的：工具参数按字段顺序流式到达，画布可以先画出构图，再等画法代码。调整字段顺序时要保持这个效果。

**提示词前缀要保持逐字节稳定。** 同一用户的请求共用一个缓存键。系统提示词里的素材目录只写随代码变化的内容，并按 id 排序，不放图片数量、使用次数这类随数据变化的内容。这样新作品的第一轮和作品续画都能命中缓存。

**修改作者提示词和工具说明时，遵循 `prompts.ts` 文件头引用的 Opus 5.5 与 GPT-6 Astra 官方指南。** 用英文写，平实直接，每条要求附上原因，不用大写或 MUST 之类的强调，规则要写具体，不写泛泛的告诫。作者的行为契约也写在这些提示词里：
- 主题说不清时用 `ask_user` 一次问清；
- 简报的依据要逐字引用用户说过的话（`setBrief` 会校验）；
- 简报里的立意（`concept`）是作者自己定的视觉想法，不引用用户的话；`set_brief` 的参数（`tools.ts` 的 `settleSchema`）在立意前先要两三种画法（`ideas`），每种标明种类（`ideaKinds`）且种类互不相同，只记在运行步骤里不进作品。创作模型在工具循环里几乎不做隐式推理，每一轮都使用用户设置的强度；`agent/index.ts` 的 `holdEffort` 在对话里留有别的档位时（`withLessThought` 或更早的运行留下的）追加 `configuration_update` 换回设置值。要它发散、评判，得让它写成显式输出：想法写进参数，看图后的评判写成给用户的一句进度；`view_canvas` 把意图和立意放在截图旁边，全图附上 `figure.viewFilled`。看图时按“准确→立意是否读得出→工艺”的顺序评判；
- 简报只定图意、事实和所需素材；画布坐标不在思考里算（第一稿思考约占输出的七成，主要花在排坐标上），大致放在 20 单位的格子上就写，看图后再小改，因为多看一次比事先算好便宜得多；`set_brief` 之后紧接着 `generate_images`，让图片在布局时显影；保存和看图放在同一轮；一次看图发现的问题集中在一次写入里改；只剩观众注意不到的润色就停；
- 素材按读者看到它的收获决定：主体和场景氛围值得生图；给普通读者讲日常事物时，主要部分通常也配三到六张图（正式图同样适用），没有外形的概念、长列表和专业图表不配；这些图在简报的 `cast` 和立意里就定好，不等排版后再塞；
- 全图最想让人记住的那句话写成最醒目的文字，放在它说的部分上；
- 看图先查图里关于时间、方向、比例、因果和数字条件的说法，写成 `claims`；有人会据此行动的专业事实（医疗时限、剂量、法律、金融公式、统计）要定向搜索；
- 结束前必须看过最新版本的所有非空场景，并且截图里没有运行错误（`requireObserved`）。

改提示词前先读一遍现有的 `AUTHOR` 和 `guides.ts`，在原有结构里修改，不要另起一套写法。

**提示词的三层。** 常驻指令只放每个作品都用得上的内容，其余按需读取，这样系统提示词每轮带的 token 少，同时前缀依然逐字节稳定。放在哪一层按“多少作品用得上”决定，新增规则时也照此判断：
- 系统提示词（`prompts.ts`）：`AUTHOR` 加 `catalogue` 的索引。`# Guides` 由 `guideIndex` 从 `guides` 的 `when` 生成，每个主题一行“什么时候读”；`# Library` 每个画法一行，取 `about` 开头到第一个冒号、分号或句号的那一句（`gist`），所以 `about` 要以“它是什么”开头，后面方括号里按声明顺序列出参数名，常用画法（`picture`、`label`、`arrow`）因此不必先读卡片。目录由 `kit()` 取全部画法和质感（不分页），否则哪些画法进目录会随使用次数变化。
- 指南（`guides.ts` 的 `guides`，主题列表是 `contracts` 的 `guideTopics`）：`drawing`、`diagrams`、`maps`、`exploration`、`formats`、`copy`。几乎每个作品都要的内容不做成指南：怎样请求图片写在 `generate_images` 的说明和 `pictureRequestSchema` 的字段里，怎样组合图片写在 `AUTHOR` 的 Materials 一节（原来的 `pictures` 指南已删，`i18n.tsx` 保留它的名字给旧记录显示）。`cards` 是读这个主题时一起给的画法卡片。指南不再指向别的指南（官方建议引用只深一层）。新增主题要改 `guideTopics`、`guides` 和 `i18n.tsx` 的 `steps.guideTopics` 中英文。
- 卡片（`materials` 的 `drawingCard`）：库画法的完整说明、参数、默认尺寸和示例数据。

`draw_guide` 是工具循环里的普通步骤，结果追加在对话里，不改系统提示词和工具列表，所以不破坏缓存。`guidesRead` 从 `ctx.input` 算出已读内容，重复请求只回 `alreadyAbove`；压缩替换对话后自然清空，可以重新读。`readGuides` 返回纯文本：每个指南在 `## 主题` 下，卡片每张一行 JSON，循环对字符串结果不再 `JSON.stringify`。作者可能不读就动手，所以有两处提醒：`set_brief` 的结果在还没读过、也没在同一批里请求指南时附 `guides`（`guidesRead(input, batch)` 把同批里还没有结果的 `draw_guide` 也算作已读），`write_work` 的结果列出作品用到但没读过卡片的库画法（`cardsUnread`），每个画法只提醒一次。

一轮有多个工具调用时，`loop` 等这一批的结果全部写入后才追加图片消息，因为 DeepSeek 的 Responses 接口把夹在结果之间的消息当成调用没有结果（400）。

输出被截断时三种适配器都抛 `models/types.ts` 的 `CutOff`，带服务方给的原因、usage 和 `thoughtOnly`（只有思考、还没写出内容）。`loop` 把用量计入 `run.usage.failed` 并记进 trace；`thoughtOnly` 时由 `withLessThought` 按该格式改变强度的方式（对话里的 `configuration_update` 或请求参数）以模型接受的最低档重试一次，再失败就停止。这一轮之后由 `holdEffort` 换回设置的强度。

工具说明写清做什么、什么时候用、返回什么和失败时怎样；字段的含义写在 schema 的 `.describe` 里（JSDoc 模型看不到），不在系统提示词里重复。

**界面像绘图工具，不像聊天机器人。** “AI 味”的界面有两波：第一波是靛紫渐变、居中大标语、三张圆角卡片；第二波是有人要求“去 AI 味”后模型给出的米色底、衬线标题、赤陶色点缀（正是 Claude 的配色）。两种都不要。颜色都在 `modules/ui/base.css` 的 token 里：白底和中性浅灰（不带暖色），文字近黑，`--blue`/`--ai`/`--ai-deep` 是唯一的强调色，用于选中、焦点、链接、进行中的标记和主要按钮（`.primary`、发送），画布里的 `ACCENT` 与它相同；`--brand` 只给灯笼标志；还没出现的图片和截图用 `--hatch` 铅笔排线（`hatch` 动画）。标题用 `--font-display` 无衬线半粗体，`--font-serif` 只留给作品里的内容；不用毛玻璃（`backdrop-filter`），页面加载时不做上浮动画，动效只回应用户的操作；卡片圆角 8～12px、阴影很轻，不加彩色色块底。不要加模糊色块、流光、闪烁星星这类“AI 生成中”的样子，图标里也不用 `Sparkles`。手机页同样遵守这些：浮在画布上的按钮和底部面板是白底、轻阴影、圆角，没有渐变和毛玻璃。画室里用户的请求是左对齐的引文，不是对话气泡。页面上不放解释性的提示段落（版本说明、手势说明、代码说明之类），按钮和标签自己说清；作者的思考和简报的 `ideas`/`concept` 要显示，绘制过程靠它们才有看头：画室把连续的思考合成一行（`Thoughts`），进度行在两次工具之间显示最新思考的标题（`Studio.tsx` 的 `thinkingOf`）：GPT 的思考摘要无论怎么要求都是英文，与页面语言不同的思考照样显示，只用 `lang` 标出并调浅（`foreign`），因为模型推理的几秒到十几秒里，这是唯一能看的东西；画布还空着时 `SceneView` 的便签先抄请求原话，下面一行与进度行同出 `currentOf`（是思考时标“正在想”，否则是正在做的事或作者最新的进度说明），`set_brief` 之后换成主题、想过的画法、选定的想法、受众和画风；语域（严谨/个性）不显示。收起的输入框条用 `Stages` 显示五格进度（`stageOf`：构思、定内容、备素材、起稿、检查，跳过的阶段算已过），画室关着时再加当前一行和 `Clock` 已用时间。token 和费用只给有 `models.manage` 的账号看（`WorkUsage`、运行的费用按钮），普通用户按提问次数计。模块在界面上的名字用 `shownName`（没有名字和文字时是画法名，不露出 ID），`labelOf` 仍是作者看到的名字。界面文案不必处处说“AI”：作者在做的事直接说“正在画”“等你回答”，生成图片的来源标注“AI 生成”保留。

**面向用户的文字要中英双语。** 前端文案在 `apps/web/src/i18n.tsx`，以 `zh` 为基准，`en` 必须有相同的键；共享组件的文案在 `modules/ui/src/words.ts`。服务端内部说中文，错误在离开服务时由 `modules/contracts/messages.ts` 按请求的语言翻译，所以新增的错误信息要在那里补上英文。写给模型的文字保持原样，不翻译。

**测试要验证真实行为。** `agent.test.ts` 用 `vi.mock` 替换掉 `models` 和 `observation`，按脚本逐轮返回工具调用。前端的作品页行为由 `apps/web/regression/` 的三个套件在真实浏览器里验证，见“前端的分层”。素材相关的测试用 `@drawy/materials/testing` 的 `serveLibrary`，在临时目录里起一个带种子数据的真实素材库，并拦截 fetch。新测试沿用这两种方式，不要另写素材库的 mock。测试失败时，先判断是实现错了还是测试过时了，不要为了让测试通过去改断言或写特例。

**`promo/` 是独立工程。** 它是 60 秒宣传片，有自己的 npm 依赖和 `build.sh`，不属于主程序的构建和测试；只有任务明确涉及时才去动它。

Responses 服务是否接受 `max_tool_calls` 和 `tool_choice: allowed_tools` 记在绘制模型的 `toolLimits`（默认 `true`，旧目录读出时补上），经 `settingsFor` 进入 `Role.toolLimits`，`responses.ts` 的 `narrow` 只读它，不按地址判断。DeepSeek 等不支持的服务由管理员关掉，请求不发送这两项，独立搜索仍在 DrawY 执行时按预算拒绝超额调用，工具列表保持不变。
