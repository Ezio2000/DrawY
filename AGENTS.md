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

服务地址可以用 `DRAWY_MATERIALS_URL`、`DRAWY_CAPTURE_URL`、`DRAWY_INTERNAL_URL` 覆盖，其中最后一个是截图服务回访主程序的地址。`data/` 存的是真实的用户数据，测试和调试时用临时目录，不要清理或改写它。

## 一次运行如何流动

1. 用户在某个场景发出请求。`apps/server/app.ts` 收到 `POST /api/works/:id/runs`，调用 `modules/agent` 的 `Agent.start`。
2. 同一作品的对话上下文会延续：新一次运行沿用上一次运行保存的 `input`，再追加用户消息和作品当前的状态。用户在两次运行之间自己改过作品（手动编辑、撤销或恢复）时，状态前面会列出作者上次保存之后哪些模块被改、移动、添加或删除（`editing.changesBetween`），提示词要求作者保留这些修改。
3. 作者按 `modules/agent/tools.ts` 里定义的工具工作：
   - `ask_user` 暂停运行，状态变为 `waiting`，用户回答后由 `resume` 继续。
   - `set_brief` 定下简报。
   - `find_materials` 检索素材库。
   - `generate_images` 在后台生成图片（`modules/images`）。这些图片先在素材库里预留 ID，作者马上就能引用。每张图除了作者给的内容参考图，还会带上作品里已有的同风格图片和风格样张作为风格参考图（`styleReferences`），保持画风一致。
   - `read_work` 读取作品，`write_work` 修改作品，`view_canvas` 截图查看。`view_canvas` 可单独调用，或放在同轮一个或多个 `write_work` 之后的最后一项；按顺序保存后截图，任一保存失败就跳过本轮截图。`ask_user` 和 `finish` 仍需单独调用。
4. `write_work` 交给 `modules/workspace` 原子提交。提交时校验 `baseRevision`，不一致时返回 409；把作品新提到的素材从素材库取进作品的 `materials` 快照，不再提到的移出去，已有的库画法和质感换成库里的当前版本（作者的素材目录描述的就是当前版本）；再校验整个作品，最后由 `modules/storage` 写成一个新版本，记下 `Cause`。
5. `view_canvas` 经 `modules/observation` 请求截图服务。截图服务用 `modules/runtime/document.ts` 生成页面，加载 `/runtime/runtime.js` 渲染场景，截下图片，连同几何信息一起作为图片消息送回同一段对话。
6. 运行过程中的每个变化，都以 `run` 事件经 SSE（`/api/events`）推给前端。前端由 `modules/canvas` 把过程画成石墨线起稿和图片显影的动画（没有跟着笔尖走的铅笔）。整个过程同时由 `modules/trace` 记入 `trace.sqlite`。前端右侧的画室（`apps/web/src/Studio.tsx`）把每次运行的步骤按工具分别呈现（每种 `ToolActivity` 一个视图，未知的托管工具走 `hosted`），步骤里只标出保存的是第几稿；预览和恢复在单独的草稿面板（`Drafts.tsx`，按请求分组列出 `/revisions`）。输入框（`Composer.tsx`）平时在页面下方，模型选择 `ModelBar` 在它右下方；`App.tsx` 的 `engaged`（运行中或等待回答）为真且画室打开时，输入框移到画室底部、不带模型选择，运行结束回到页面下方；作者开始运行时画室自动打开。画室和草稿面板宽度分开（`panelWidths`，`--journal`/`--drafts`），由 `Resizer` 拖动并按面板记在 `localStorage`。账单由 `Studio.tsx` 的 `spentBy`/`Bill` 按 `costOf(run.usage, run.prices)` 算出。回复用 `Markdown.tsx` 渲染，`tidy` 去掉模型留下的 `\ue200…\ue201` 引用记号并移动引用位置。

托管工具（模型服务方自己执行、输出项类型以 `_call` 结尾的，如 `web_search_call`）在 `agent/index.ts` 里统一处理：成为运行步骤（`web_search` 有专门的活动，其余是 `{ name: "hosted", tool, detail }`），按 `run.usage.hosted` 计数，并用 `tracer.record` 记成所在轮次下的 `tool` 记录（`attrs.hosted`、`args` 是动作、`output` 是原始项）。`trace` 的 `meters` 按 `attrs.meter`、工具名或种类汇总次数、耗时和 token，所以新增工具不用改 trace。`run.usage` 累计每轮和压缩的 token、托管工具次数与生图用量（`images` 从图片接口返回的 `usage` 取）。搜索是否合理由 `prompts.ts` 的 `# Research` 一节约束，`set_brief` 和 `view_canvas` 的结果在本次运行搜索过时附上 `research`（次数、打开过的网页），提醒作者按已有来源判断。硬预算在 `steering`：每次请求 `SEARCH_LIMIT` 次、第一稿保存后 `SEARCH_AFTER_DRAFT` 次，预算内的轮次带 `max_tool_calls`，用完后带 `tool_choice: allowed_tools`（只列函数工具）；两者都不改 `tools`，所以不破坏缓存前缀，不要改成增删 `tools` 的做法。轮次的 trace 在 `request.steer` 里记下这次的限制。

导出：`/api/works/:id/scenes/:scene/picture`（PNG，`?format=pdf` 为一页矢量 PDF，截图服务 `render` 的 `format`），`/page` 是可离线打开的单文件交互网页（`runtime/document.ts` 的 `standaloneDocument`：内嵌 `dist/runtime/runtime.js` 和作品图片；SVG 以文本 data URL 内嵌，`scene.ts` 在它上面替换 `currentColor` 完成着色；详情 HTML 和画法代码里写成地址的 `/materials/files|thumbs/…` 也连同查询串整个换成 data URL（`color` 交给素材库着色、`size` 定缩略图大小，HTML 里的 `&amp;` 也认），SVG 的引号和括号一并转义；以 `/` 开头的 fetch 改到导出时的站点，`/materials/geo` 因此带 `Access-Control-Allow-Origin: *`）。JPG、社交卡片、复制和系统分享在前端由 PNG 生成（`Export.tsx`）。剪贴板和系统分享要在点击的临时授权内调用，截图可能要好几秒：复制在点击时立即 `clipboard.write`，传入图片的 Promise；分享不能等，所以菜单一打开就开始截图，图好之前分享项显示准备中，点击时直接 `share`。

## 创作、搜索与生图的组合

模型配置的结构是“规格 + 适配器”，新增接入方式、接口格式或搜索服务商都是加条目，读它们的代码不改：
- `contracts/models.ts`（由 `contracts/index.ts` 转出）是唯一说明“谁能做什么”的地方：`channelSpecs`（`api`/`oauth` 各自的固定地址、能说的接口格式、速度档、能否内置搜索、能否固定提供商、要不要 Account ID）、`protocolSpecs`（每种接口格式的官方地址、能否内置搜索、是否有速度档）、`searchProviderSpecs`（地址、是否必须有 Key、是否由服务商读网页）。`settleWriter`/`settleProvider` 按规格改正模型（格式不被支持时退回接入方式的第一种、内置搜索不能用就不开放、可选速度只留连接和格式提供的、默认档位取可选的），`modelCatalogSchema` 和设置页都用它；`reconnect` 在供应商换接入方式时把地址换成 `endpointFor` 给的地址。`offersBuiltinSearch`、`speedsOf`、`pinnedProvider`、`searchReady`、`protocolFor`（新模型按地址猜格式）都从规格推出。`picked`/`settingsFor`/`menuFor` 是“用户选了什么、落到哪个默认”的唯一实现，`UserStore.settings()` 和 `/api/models` 只调用它们；`costOf` 是费用的唯一算法，前端账单和运行记录都用它。
- `modules/models` 每种格式一个适配器（`responses.ts`、`chat.ts`、`anthropic.ts`，接口见 `types.ts` 的 `Adapter`），在 `index.ts` 的 `adapters: Record<Protocol, Adapter>` 里登记。`generate(role, turn)` 收一个 `Turn` 对象（`instructions/input/tools/signal/onEvent/budget/cacheKey/steer/effort`），先做通用处理（凭证检查、`blind`、输出上限），再交给适配器。按格式不同的行为都问适配器：`effortControl`（`request` 每次请求带档位、`conversation` 在对话里插 `configuration_update`、`fixed` 不变）和 `decidingEffort` 决定 `agent` 的 `deliberate`；`narrow` 决定 `steering` 能否不改工具列表就收窄（只有 Responses 有）；`describe` 给 trace 的 `request` 补字段（Responses 的 `serviceTier`），由 `requestOf` 合成。`http.ts` 放共用的 `headers`、`post`（自动带 `pinnedProvider`）和 SSE 读取 `events`。`agent` 里不再出现按 `protocol` 分支的代码，加格式时也不要再加。
- `modules/search` 的 `clients: Record<SearchProvider, Client>` 每个服务商一项：`search`，以及服务商自己读网页时的 `read`（没有就由 DrawY 直接读）。
- 设置页 `apps/web/src/ModelSettings.tsx`：`WriterSection` 和 `ImageSection` 共用 `ProviderSection`（供应商列表，展开是连接字段和它的模型列表；两者的差别写成一个 `Kind`），`SearchSection` 列搜索服务并设默认联网方式。添加供应商从 `presets` 起步；默认模型不能删，它所在的供应商也不能删。`ConnectionFields` 按规格只显示适用的控件（Account ID），模型的格式、固定提供商、可选速度和缓存写入价格只在适用时出现。价格用 `NumberField`（文字输入、保存数字）。行、分组、条目这些通用部件在 `SettingsParts.tsx`。新的接入方式、格式或服务商要在 `i18n.tsx` 的 `settings.channels/credentials/protocols/protocolHints/providers/providerHints` 补中英文，类型检查会提示缺哪一项。

`ModelCatalog` 里三样东西分开配置、分开选择，互不关联：`writers`（绘制供应商，每个 `Provider` 是连接加 `models: WriterModel[]`）、`painters`（生图供应商，`models: ImageModel[]`）、`searches`（搜索服务），默认值都在 `defaults: { writer, image, web }`。模型 ID 在同类里全局唯一，用户的选择按它保存；显示名默认是 `writerLabel`/`imageLabel` 给的 `模型[供应商]`（固定了 OpenRouter 提供商时是 `模型[供应商/提供商]`），填了 `name` 就用它。`WriterModel` 记管理员开放给用户的 `efforts`/`speeds`/`builtinSearch` 和各自的默认 `effort`/`speed`，以及价格 `prices`（每百万 token 的 `input/cached/cacheWrite/output`、内置搜索每次 `search`）和速度倍率 `speedRates`（缺省取 `speedRates` 常量）；`ImageModel.prices`（`ImagePrices`）是每张图，以及 Images API 分开计价的 `textInput`/`imageInput`/`output`/`textOutput` 每百万 token：`imageTokensOf` 按响应里的 `input_tokens_details`/`output_tokens_details` 拆开（不拆的服务商全算文字输入），`run.usage.images` 分别累计，所以带风格参考图的生图按图片输入价计算；`SearchService.prices` 是每次查询和每次读网页。存的目录读不通时 `Storage.models()` 换成 `defaultCatalog()`，不做旧格式迁移。`UserSettings` 记 `writer`、`effort`、`speed`、`web`、`image`（都可为空）；`picked` 落定：模型不在了用默认，强度取模型可选里最近的，速度不可选就用模型默认，`web` 是 `off`、`builtin` 或搜索服务 ID（服务 ID 不能叫这两个名字），经 `webFor` 落定——要内置搜索而当前模型没有、或服务没有 Key 时是 `off`，但想要的 `web` 原样保存，换回有内置搜索的模型就生效。`UserStore.settings()`（即 `settingsFor`）合成 `Settings`：`author`（运行时的 `Role`）/`authorName`、`search: { mode, service? }`、`image`/`imageName`，以及这次的 `prices`（`RunPrices`：按速度倍率换算后的 token 价格、按搜索方式取的每次搜索和读网页价格、生图价格）。

运行时的 `Role` 是供应商连接加所选模型和选项：`protocol`（`responses`、`chat` 或 `anthropic`，ChatGPT OAuth 只能是第一种）、`vision`、`tools`、`effort`/`speed`（用户选的）、`efforts`（模型开放的档位，决策轮在其中提升；`efforts` 里有 `max`）、`maxOutput`。适配器只读 `Role`，不知道目录的形状。`models/index.ts` 的 `generate` 对外只说 Responses 的格式：`protocol: "chat"` 时由 `chat.ts` 把 Responses 项转成 Chat Completions 消息（`toMessages`：同一轮的函数调用合成一条 assistant 消息，夹在调用结果之间的图片消息挪到结果之后，`configuration_update`、托管调用和加密推理丢掉），再把流式块转成同样的事件和项（`reasoning_content` 存成 `{ type: "reasoning", reasoning_content }`，Responses 请求会滤掉它）；不能看图的模型由 `blind` 把图片换成文字。Chat 请求没有 `prompt_cache_key` 和 `tool_choice`，思考强度按请求传 `reasoning_effort`（取 `turn.effort`），所以 chat 适配器的 `effortControl` 是 `request`：`deliberate` 直接返回这一轮要的档位（决定作品的轮次取它接受的最高档），不插 `configuration_update`。

`protocol: "anthropic"` 由 `models/anthropic.ts` 的适配器用官方 `@anthropic-ai/sdk` 调 Messages 接口（`baseUrl` 是 `https://api.anthropic.com`，末尾的 `/v1` 会去掉；SDK 不重试，重试交给 agent，错误转成 `模型请求 <状态>` 的说法）。`toAnthropic` 把 Responses 项转成消息：同一轮的模型项合成一条 assistant 消息，调用结果放在下一条 user 消息最前面，结果之间的图片和 `configuration_update` 挪到结果之后；没有工具的请求（压缩摘要）把调用和结果写成文字。Claude 返回的每个项都在 `anthropic` 字段里留着原始内容块（签名的 thinking、带 citations 的 text、tool_use、`server_tool_use` 加搜索结果），下次原样发回，因为较新的模型会校验 thinking 所在的对话前缀；`forResponses` 在发给 Responses 时去掉这些块、Claude 的 thinking 和它自己的搜索，`toMessages` 本来就忽略它们，估算上下文时 `anthropic` 也不计。请求固定带 adaptive thinking（`display: "summarized"`，摘要作为思考步骤显示）、`output_config.effort`、系统提示词和最后一个工具上的 `cache_control` 以及顶层自动缓存，函数工具带 `eager_input_streaming` 让画布边流边画。按模型版本（`claudeVersion` 同时接受 `5-5`、`5.5`，以及提供商前缀和日期后缀）加 beta：`perTurnEffort`（Opus ≥ 5、Sonnet/Haiku ≥ 5.5、Fable/Mythos ≥ 5.1）时 `configuration_update` 变成只带 `output_config.effort` 的 system 消息，未开启“决策轮沿用设置”时，`deliberate` 对它们像 GPT-6 一样插入（决定作品的轮次取接受的最高档），其他 Claude 模型保持设置的强度，因为改请求级强度会让缓存失效；thinking 与对话绑定的模型带 `block_binding: drop_block`，`withoutOldPictures` 之类改写历史时只丢掉失效的 thinking；不带 `fallbacks`：被拒答的轮次不换模型续写，运行以“模型拒绝了这一轮的内容”失败（不重试），已保存的版本保留。内置搜索是 `web_search_20260209`（4.6 以前的模型用 `web_search_20250305`），每次请求 `max_uses` 8 次，`server_tool_use` 和结果合成 `web_search_call` 项，所以步骤、计数和 trace 与 OpenAI 的一样；Messages 没有不改工具列表就收窄工具的办法，适配器没有 `narrow`，`steering` 对它返回空，画出第一稿后的搜索预算只对独立搜索生效。`pause_turn` 在适配层里接着请求；`max_tokens`、`refusal` 和中途断开都按失败处理。

一次运行只有一种搜索：`toolsFor(settings)` 在 `builtin` 时加托管 `web_search`，`service` 时加 `tools.ts` 的 `searchTools`（函数 `web_search {queries}` 和 `open_page {url}`，由 `modules/search` 调服务商：DeepSeek 的 `/search`、`/fetch`，Tavily 的 `/search`、`/extract`，Brave 和 SearXNG 只搜索、网页由 DrawY 直接读取并去掉标签），`off` 时都不加。两种搜索都记成 `web_search` 步骤（`open_page` 的 `action` 是 `open_page`），所以 `searchesLeft`、`research` 不分来源；独立搜索的预算在执行时检查，按查询计（`cost`：服务商每个查询收一次费，一次调用带几个查询就算几次；读网页和托管搜索按调用算一次），剩下的不够时只问前面几个查询、结果里用 `notAsked` 列出没问的，预算已用完就去掉这一步并回报搜索已关闭（`research` 对独立搜索给 `searchQueriesLeft`，托管搜索给 `searchCallsLeft`），Responses 协议下用完后还会带 `allowed_tools`（排除两个搜索函数）。`run.usage.searches/pages` 计搜索和读网页次数（托管搜索按 `action` 分，独立搜索的 `searches` 按实际问过的查询数），`run.usage.cacheWrite` 记 Claude 的缓存写入（适配器在 `input_tokens_details.cache_write_tokens` 报出）。`run.services` 记下这次的绘制模型、强度、速度、搜索方式和服务、生图模型的名字，`run.prices` 记下开始时定下的价格，费用是 `costOf(run.usage, run.prices)`，之后改价格不影响已有运行；`/api/traces` 和 `/api/traces/:id` 给每条记录附上对应运行的 `cost` 和 `services`。前端 `Studio.tsx` 的 `spentBy` 只读 `run.usage`，`WorkUsage` 显示作品累计。

上下文达到 20 万 token 时 `compact` 把对话换成摘要。大小取上一轮 `usage.input_tokens`（记在 `Context.measured`）加之后新增项的估算，估算不计 `encrypted_content` 和图片 base64；摘要用 low 推理强度、16k 输出上限，并去掉对话里的 `configuration_update`；摘要失败时只把较早的截图换成文字占位，运行继续。

## 账号、角色与模型

账号的角色记在 `users.role`，角色在 `roles` 表（`storage` 的 `roles/role/saveRole/deleteRole/account/accounts/setRole`，`identity` 的 `saveRole/removeRole` 做校验）。权限清单是 `contracts` 的 `permissions`：`models.manage`、`materials.all`、`materials.manage`、`accounts.manage`。内置角色 `admin` 读出时永远拥有全部权限（以后新增的权限也自动有），不能修改；`member` 是新账号的默认角色，权限可改、不能删；删掉自建角色时它的账号变回 `member`。第一个注册的账号是 `admin`；旧库升级时最早的账号成为 `admin`；`setRole` 不允许去掉最后一位管理员。

注册要邀请码：`identity.signUp` 在库里还没有账号时直接注册（第一个账号设置站点），之后要求一个未使用的邀请码，建账号和标记邀请码已用在同一个事务里，注册失败（比如用户名重复）邀请码仍可再用。邀请码存在 `invites` 表（`storage` 的 `invites/addInvite/useInvite/deleteInvite/hasAccounts`），由 `createInvites` 生成 `XXXX-XXXX` 形式、不含易混字符的码，输入时 `inviteCode` 忽略大小写、空格和连字符。管理接口 `/api/admin/invites`（列出、生成 `{count}`、删除未使用的）要 `accounts.manage`；已用的邀请码不能删，留作谁凭它进来的记录。注册页先问 `GET /api/auth/signup`（不需登录）是否要邀请码。`identity.register` 本身不查邀请码，供测试和内部直接建账号。

作品标题：用户重命名（`store.rename`）会在作品上记 `named: true`，之后作者运行里的 `write_work.title` 和第一次简报都不再改标题（`writeWork` 返回 `keptTitle`，工具结果里告诉作者），撤销、恢复也保留它。这条规则只出现在工具结果里，不写进系统提示词或工具说明，保持缓存前缀不变。生成图和上传图的 ID 先截断再去首尾连字符；`take` 的 `ID`/`QUOTED` 正则接受 `--`，兼容以前生成的 ID。服务端用 `app.ts` 的 `allowed(c, 权限)` 拦截，管理接口都在 `/api/admin/*`；前端用 `account.tsx` 的 `useCan()` 决定显示什么，但它只是界面，权限以服务端为准。新加权限时要补 `permissions`、`i18n.tsx` 的 `settings.permissions/permissionHints` 中英文，以及服务端拦截。

绘制模型的 `decisionUsesSetting` 对应“决策轮沿用设置”，默认关闭。开启后 `deliberate` 在构思和看图评判轮同样使用 `role.effort`，不自动提升；已有上下文最后一次 `configuration_update` 若仍是高档位，会追加设置档位恢复它。该选项对 Responses、Chat Completions 和 Messages 的决策策略都生效。

输入框右下方的 `ModelBar` 是五个独立的选择：绘制模型（按供应商分组）、思考强度（模型开放多于一档才出现）、速度（`menuFor` 只在开放多于一档时给 `chosen.speed`）、联网搜索、生图模型；按钮不带下拉箭头。选了之后前端先用 `chosen()` 乐观显示，再 `PUT /api/settings` 并重新读 `/api/models` 看落定结果。地址、凭证和价格只在设置中显示。

绘制模型的可选 `provider` 保存 OpenRouter 提供商标识。设置页的“固定提供商”留空时自动路由，填写后 Responses、Chat Completions 和 Messages 都传 `provider: { only: [标识], allow_fallbacks: false }`；不能切到其他提供商，渠道不可用时返回错误。轮次的 `request.provider` 同样记录这个限制。

模型配置全站共用：`ModelCatalog` 存在 `system` 表，只有 `models.manage` 能读写（`/api/admin/models`）。每个用户自己只存 `UserSettings`（长期偏好和五个选择），`/api/models`（`ModelMenu`）只给出名称、供应商名、说明、是否已接入、看图能力、开放的强度和速度、有没有内置搜索，以及落定的选择，不给凭证和价格。`UserStore.settings()` 把这两者合成运行要用的 `Settings`，`agent` 和 `images` 只读这个结果。

## 手动编辑如何流动

用户在绘图页点铅笔（或双击画上的文字）进入编辑模式，右侧面板换成 `apps/web/src/Editor.tsx`。编辑模式下 `Canvas.setEditing(true)`：画布在捕获阶段接住点击，画法里的按钮和模块的跳转目标都不响应；单击选中，Shift 多选，任何模块按下即可拖动；双击按坐标找到模块影子 DOM 里的文字或图片，交给 `options.point`。

每个操作都是 `modules/editing` 里的纯函数，从当前作品算出一份 `WorkEdit`：`setData`、`setStyle`、`moveParts`、`removeParts`（连带删掉相关连线和检查）、`duplicate`（复制品自成一组，并复制它们之间的连线）、`arrange`、`add`、`replace`。`replace` 先在模块数据里找要改的字或图片 ID（改的若是某一项的 `name`，数据里所有与它完全相同的字串一起改，比如地图的路线、区域、`highlights` 按地点名引用它，只改一处路线就会丢掉这个点）；找不到时，如果它在画法代码里只出现一次，就按所在位置转义后替换，画法被别的模块共用时先为这个模块复制一份，替换后代码必须还能解析；都不行就返回 `null`，前端把修改要求写进输入框交给作者。`fieldsOf` 决定面板显示哪些控件：先是画法 `params` 声明的（作品画法自带名字，库画法的名字来自 `i18n.tsx` 的 `edit.params`），再是数据里其余的文字、颜色、数字和开关；小写的英文单词当作代码里的状态，不显示。

前端的 `change()` 把这些修改排成队，依次从上一次结果出发，经 `POST /api/works/:id/edits` 交给 `writeWork`，原因记为 `{ kind: "edit" }`，作者运行期间返回 409。用户自己造成的版本（手动编辑、撤销、重做）在画布上安静替换，不播放起稿动画。重做只在撤销后作品没有别的变动时可用，记录在前端。

## 模块职责

`modules/` 下各模块之间用相对路径（`../x/index.ts`）互相引用。

- `contracts`：作品协议（`Work`、`Scene`、`Instance`、`Link`、`Drawing`、`Brief`、`WorkEdit`）、运行记录（`Run`、`Step`、`ToolActivity`）和设置。前后端、运行时和作者工具共用这一份 schema，它是协议的唯一来源。
- `workspace`：`createWork`、`writeWork`、`setBrief`、`restore`、`undo`，以及 `validateWork`。
- `editing`：把手动操作变成 `WorkEdit` 的纯函数、面板控件的推断（`fieldsOf`），以及两个版本之间的差别（`changesBetween`）。前后端都用，不依赖存储和素材库。
- `runtime`：画法执行环境。画法接收 `api`（`svg/html/mermaid/material/materials/draw/effect/emit`，连线另有 `from/to/fromSide/toSide`），交互脚本使用 `on/set/move/openScene/openDetail/animate/cleanup`。打包入口是 `browser.ts`，`scene.ts` 负责场景，`fixture.ts` 供测试使用。
- `agent`：运行循环与重试（`index.ts`）、工具 schema（`tools.ts`）、系统提示词与素材目录（`prompts.ts`），以及解析流式到达的工具参数（`partial.ts`）。
- 搜索方式为 `builtin` 的创作轮次在自定义工具旁提供 OpenAI 内置 `web_search`（`search_context_size: "low"`）；搜索由 OpenAI 执行，`web_search_call` 随其他输出原样进入后续上下文和 trace，不走本地工具执行器。运行步骤记录搜索查询或页面 URL；消息保留 `url_citation` 的位置、标题和链接，前端在原文位置显示可点击来源。OAuth、Chat Completions 和上下文压缩不添加内置搜索工具；Anthropic 接口的内置搜索由 Claude 执行，见上文。
- `models`：用 OpenAI Responses 的项和事件调用创作模型，每种接口格式一个适配器（`responses.ts`、`chat.ts`、`anthropic.ts`），并负责缓存键；`headers` 也供生图使用。
- `search`：独立搜索服务的客户端（`searchWeb`、`readPage`），每个服务商一项 `Client`。
- `observation`：截图服务的客户端。`capture.ts` 在截图容器里运行，运行时测试也直接调用它。
- `images`：按作品风格生成图片，并把结果回报给作者。风格参考图由 `styleReferences` 选出，记在素材的 `origin.styleReferences`；生成图一律是该用户的私人素材。
- `materials`：主程序访问素材服务的一层，只经 `@drawy/materials/client` 访问，不直接读素材库的数据库。
- `canvas`：前端画布，负责视角、选择（含多选）、移动、缩放、编辑模式和起稿动画（`ink.ts`）。第一次挂载（打开作品、进入子场景）不播放落笔动画，只有之后 `update` 换上的新版本才落笔。
- `storage`、`identity`：按用户隔离的 `data/drawy.sqlite`，以及账号、角色权限和全站模型配置。`UserStore.viewer`（`{ id, all }`，`all` 来自 `materials.all`）是访问素材库读接口时代表用户的身份，读素材一律传它；写入（预留、显影、上传、记录使用）仍传 `userId`。
- `trace`：基于 AsyncLocalStorage 嵌套记录，任何模块都可以直接调用 `tracer`，不需要层层传参。
- `ui`：共享的 React 组件和品牌素材。

`materials/` 是独立的素材包和服务，有自己的 SQLite、文件和检索。素材严格分公共（`owner: null`：策展素材和被发布的图片）和私人（`owner` 是用户 ID：上传和生成的图片一律如此）。素材服务按请求头识别身份：`x-drawy-user` 是用户，`x-drawy-access: all` 表示可看所有人的素材（由主程序按 `materials.all` 加，客户端用 `viewerHeaders`/`Viewer` 生成）。`browse` 的 `shelf`（`public`/`mine`/`others`，最后一种要求 `all`）把素材分栏；`publish` 把用户的图片设为公共或还给 `origin.user`，策展素材不能改；`styles()` 的样张和计数只取公共图片，私人图片不会通过风格露给别人。作者的 `find_materials` 只传用户 ID，不带 `all`，所以作者只在公共素材和本人素材里检索；管理员要用别人的素材时从素材库附加，`take` 用 `viewer` 读取。素材分四种：`picture`、`drawing`、`effect`、`style`。策展素材在 `materials/seed`：画法源码在 `seed/drawings/<id>.js`，元数据和示例数据在 `drawings.json`，图片在 `seed/files`。所有素材共用一个 ID 空间，新画法的 ID 不能和图片重名（比如已有图片 `tree`，层级树画法叫 `hierarchy`）。结构图与图表画法（`node`、`hierarchy`、`layers`、`quadrant`、`compare`、`pyramid`、`venn`、`mindmap`、`steps`、`swimlanes`、`fishbone`、`sequence`、`concentric`、`gantt`、`bars`、`donut`、`gauge`、`stat`、`radar`、`checklist`、`callout`）只用风格 token 上色、可选 `effect` 参数套质感（所以数据里别用 `effect` 当别的字段名）；新加的参数名要在 `i18n.tsx` 的 `edit.params`、选项值在 `edit.options` 补上中英文；`runtime.test.ts` 会用示例数据把每个库画法都画一遍，新画法要在那里能无错画出。地图画法 `geomap` 把经纬度投影到真实的海岸线、湖泊、河流和（可选）国界、一级行政区界上。数据在 `seed/geo`：`physical`（总览用的 1:5000 万陆地湖泊与 1:1000 万河流）、`countries`、`subdivisions`，以及近景用的 `detail-<列>-<行>`（1:1000 万陆地、湖泊和岸线，按 15° 分块、精确到千分之一度，缩放级别 ≥ 4.5 时画法只读视图覆盖的几块；块内填色在块边被切开，所以不描边，岸线单独成线）。坐标存成差分整数，单位是 1/scale 度（默认百分之一度，分块文件自带 `scale`）。由 `pnpm --dir materials geo` 从 Natural Earth 重新生成（`materials/geo.ts`，用 npx 跑 mapshaper，不是依赖）。政治图层只有一个视角（`view`，目前是 Natural Earth 的中国视角）：地图单元、每条边界在该视角下的分类（`FCLASS_<视角>`，不承认的线丢弃）、海上界线、一级行政区归属都按它来。规则对所有国家相同，画法和构建脚本里都不写任何具体国家：行政区裁到它所属单元在该视角下的领土；主权属于别国的单元整体算一个行政区；视角下不存在的单元并入包含它的单元。国名取 CLDR 简称（`Intl.DisplayNames`）。由素材服务的 `/geo/:layer` 提供、主程序经 `/materials/geo/` 转发，画法运行时按需 fetch 并缓存在页面里（读取以任何方式失败都会从缓存里删掉，下次绘制会重试），所以不进作品的素材快照；`runtime.test.ts` 的测试服务器也要提供这条路由。作品快照的是画法代码，地理数据却是在线读取的：作品每次写入会把库画法刷新到当前版本（`materials` 的 `take`），但没再写入的旧作品仍跑旧代码，所以改 `seed/geo` 的文件格式或图层名时，要让旧版画法仍能读到它期待的东西，或者换一个新的图层名。作者提示词要求不按位置挑库画法输出里的元素来改（库更新后顺序会变），所以作者需要的能力要做成参数，例如按名称突出河流的 `highlights`、边界颜色 `borderColor`。地势晕渲在 `seed/geo/relief`：由 `pnpm --dir materials relief`（`materials/relief.ts`，可用 `NE_RASTERS` 指向已解压的 SR_50M/SR_HR 免得重新下载）从 Natural Earth 的晕渲栅格切成三级经纬度方块（每度 6/30/60 像素，块大小 180°/30°/15°，只留有起伏的块），索引是 `relief.json`（`flat` 是平地和海面的灰度 206），图块经 `/geo/relief/<级>-<列>-<行>` 以 WebP 提供。画法按视图每度像素数选级，把图块画进一张经纬度画布，再对地图的每个像素逆投影取样，比平地暗的画成墨色阴影、亮的画成纸色高光，所以任何投影都适用；缩放级别 7 起渐隐、到 10 消失，在 OpenStreetMap 底图下铺在陆地上、公园水面道路之下，参数 `relief` 可关。投影有两种：经度跨度不到 150° 用按中纬度余弦压缩的等距圆柱，否则用以视图中央经线为中心的 Natural Earth 投影，这时数据线和多边形按中央经线 ±180° 裁开并加密（`pieces`），海面画成地球轮廓加 30° 经纬网，没有比例尺和外框；画法里取坐标一律经 `px`/`unproject`，不要再按线性换算。线条分层：国界是浅色宽带上一条细实线（争议界虚线），省界只画在“主题国家”境内，河流用水色，海岸向海一侧有晕染，线宽在世界和大洲尺度按缩放级别变细。主题国家（`focus`）是地点、路线、区域所在的国家，没有时取视图中心所在国家：只标它们的一级行政区名，其余国家只标国名；国名字号随国家在图上的大小变化，同名只标一次，数据里没有外形框的小单元（礁、小岛）不标。Natural Earth 最细只有 1:1000 万，城市里什么都没有，所以缩放级别 ≥ 7（视图两百公里左右以内）时底图改用 OpenStreetMap 矢量瓦片（OpenMapTiles 结构，默认取 OpenFreeMap 的免 Key 服务，`DRAWY_TILES_URL` 可换成别的 TileJSON 或 `{z}/{x}/{y}` 模板）：素材服务的 `/geo/streets/:z/:x/:y`（`materials/streets.ts`）取瓦片、只留水面、绿地（林地草地和城市公园，不含整片的国家公园和保护区）、水道、按等级分的道路、铁路和水道与主干道名称（只取 OSM 的 `name`，即当地写法，不分语言；要换成读者的语言由作者看图后填 `names` 参数 `{原名: 显示名}`，它替换地图从数据里取来的所有名字，国名、省名、河名、路名都算，`highlights` 用原名或显示名都能找到河），存成以瓦片单位差分编码的 JSON，缓存在素材数据目录的 `streets/<数据源哈希>/` 下（按 `DRAWY_TILES_URL` 分目录，换了数据源不会混用两家的瓦片；文件名带格式版本 `FORMAT`，改了取舍规则就加一，旧缓存自然失效），每块只取一次；所以素材服务需要外网（compose 里与主程序共用 `DRAWY_OUTBOUND_PROXY`）。画法按视图取 `min(14, floor(zoom))` 级的瓦片（最多 36 块），每块裁在自己的方格里画，块边被切开的形状就不会露出来；道路按等级随缩放出现（高速 7、国道 7.5、省道 9、县道 11、更小 12～13.5），铁路从 9 起；这一层下不再画 Natural Earth 的陆地、湖泊和河流，国界省界仍用 Natural Earth 的（政治视角统一），`highlights` 也会按名称找瓦片里的水道。有任何一块读取失败时整张图退回 Natural Earth 并在图上写明街道底图读取失败；画了街道就在角上署名 © OpenStreetMap（ODbL 的要求）。参数 `roads` 关掉道路和铁路（历史地图用，OSM 的海岸、水面和林地照旧，不会退回 Natural Earth 的粗海岸），`roadNames` 关掉路名。`materials/fixtures` 里有一块广州市中心的真实瓦片，素材和运行时测试都用它，不连外网。自动取景在多个地点时最小只留 0.02°，一个城市里的路线不会被放大成整个地区。画法里的通用规则：河流按 Natural Earth 的 `min_zoom` 随比例出现；区域名只在放得进区域时标出，标注点不在视图内或被占时在区域可见部分里找空位；某国的行政区名已标出就不再标国名；路线和区域按“每段走短的一侧”展开，数据线在与视图相交的每份世界副本上都画，跨 180° 经线不断开。`apps/web` 是 React 19 前端，用 CSS Modules 写样式，图标用 lucide-react。

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
- 简报里的立意（`concept`）是作者自己定的视觉想法，不引用用户的话；`set_brief` 的参数（`tools.ts` 的 `settleSchema`）在立意前先要两三种画法（`ideas`），每种标明种类（`ideaKinds`）且种类互不相同，只记在运行步骤里不进作品。创作模型在工具循环里几乎不做隐式推理：在 high 和 xhigh 下，定立意和看图后的轮次推理 token 通常只有几十，只有 max 会真正思考（约 300～900）。所以未开启“决策轮沿用设置”时，`agent/index.ts` 的 `deliberate` 只在这两类决策轮用 `configuration_update` 把强度升到 max，其余轮次回到设置的强度；请求级的 `reasoning.effort` 保持不变，否则缓存前缀会失效。除此之外，要它发散、评判，还得让它写成显式输出：想法写进参数，看图后的评判写成给用户的一句进度；`view_canvas` 把意图和立意放在截图旁边，全图附上 `figure.viewFilled`。看图时按“准确→立意是否读得出→工艺”的顺序评判；
- 结束前必须看过最新版本的所有非空场景，并且截图里没有运行错误（`requireObserved`）。

改提示词前先读一遍现有的 `AUTHOR`，在原有结构里修改，不要另起一套写法。

**面向用户的文字要中英双语。** 前端文案在 `apps/web/src/i18n.tsx`，以 `zh` 为基准，`en` 必须有相同的键；共享组件的文案在 `modules/ui/src/words.ts`。服务端内部说中文，错误在离开服务时由 `modules/contracts/messages.ts` 按请求的语言翻译，所以新增的错误信息要在那里补上英文。写给模型的文字保持原样，不翻译。

**测试要验证真实行为。** `agent.test.ts` 用 `vi.mock` 替换掉 `models` 和 `observation`，按脚本逐轮返回工具调用。素材相关的测试用 `@drawy/materials/testing` 的 `serveLibrary`，在临时目录里起一个带种子数据的真实素材库，并拦截 fetch。新测试沿用这两种方式，不要另写素材库的 mock。测试失败时，先判断是实现错了还是测试过时了，不要为了让测试通过去改断言或写特例。

**`promo/` 是独立工程。** 它是 60 秒宣传片，有自己的 npm 依赖和 `build.sh`，不属于主程序的构建和测试；只有任务明确涉及时才去动它。
