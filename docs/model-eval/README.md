# DrawY 模型横评：4 种绘制配置 × 2 个一句话需求（准备稿）

> 状态：**评测脚本已就绪，真实运行尚未进行。** 本次会话的环境变量里有四种模型的地址、接口格式、强度和速度，但没有任何 API Key；OpenAI、OpenRouter、DeepSeek 三家对不带凭证的请求都返回 401（见“阻塞”一节）。下文的价格、方法、脚本和降本方向都已核实或测过；所有“结果”表格要等加上 Key 后由脚本生成，文中没有任何模拟数据。

上一份[体验报告](../experience-report/README.md)固定一个模型（gpt-6.1-terra），比较它的三档思考强度，找的是“这个模型怎么画得更好”。这一次反过来：**同样的需求、同样的产品，换四种绘制模型配置**，横向比较画得好不好看、准不准、等多久、花多少钱，选出最适合 DrawY 的一种，再在它身上做降本实验。写法沿用上一份报告：先给结论和一览表，再逐个案例并排放四种配置的过程截图和成品，最后写方法与口径。

## 报告结构（仿照上一份体验报告）

1. **结论摘要**：一张总表（每种配置的成功率、首轮耗时、首个画面、轮次、输入/缓存命中、输出/推理、新图、模型费、生图费、合计、看图综合分），一句话推荐，以及“如果更看重 X 就选 Y”的备选。
2. **四种配置各自的长处与短处**：取代上一份的“关键问题”，按配置写，附相关案例。跨配置都出现的产品问题单列，按严重程度排。
3. **画得怎么样**：每题四张成品并排，按准确、立意、工艺、完整四项打分，写出扣分的具体位置。
4. **钱花在哪里**：沿用上一份“档位到底改变了什么”的做法，按配置拆成决策轮/执行轮，以及模型、生图、搜索三部分；说明各配置贵在哪里（输入、缓存写入、推理还是生图）。
5. **推荐与理由**：质量与成本、速度的取舍，列出选它要接受的代价。
6. **降本实验（5 次）**：每次一节，写清改了什么、为什么、前后对照表、看图对比、结论（采用 / 不采用）。
7. **8 次运行一览** 与 **方法与口径**。
8. **案例**：water、silk 各一节。每节有需求原话、四种配置的数据表、“用户实际看到的过程”（四列并排：三分之一处、三分之二处、完成时的页面、导出的成品）、作者提问与回答、作者最后一句话、作者的立意、我的体验（每种配置一段）、我的思考、优化建议。

同时生成可下载打开的 `report.html`（截图可放大），和上一份一样。

## 评测对象（取自环境变量）

| 配置 | 模型 | 接口 | 地址 | 强度 | 速度 | 决策轮 | 内置搜索 |
|---|---|---|---|---|---|---|---|
| Terra（默认） | gpt-6.1-terra | Responses | api.openai.com | high | **fast（2× 价格）** | 自动升到 max | 有，但本次统一用独立搜索 |
| Opus | anthropic/claude-opus-5.5 | Messages（OpenRouter，固定 anthropic 提供商） | openrouter.ai/api | medium | — | 沿用设置 | 无 |
| Sonnet | anthropic/claude-sonnet-5.5 | Messages（OpenRouter，固定 anthropic 提供商） | openrouter.ai/api | medium | — | 沿用设置 | 无 |
| DeepSeek | deepseek-flash | Responses（关闭 `toolLimits`） | api.deepseek.com | high | default | 沿用设置 | 无 |

四种配置共用：生图 `gpt-image-2.5-flare`（OpenAI API），联网方式 `SEARCH_MODE=service` 即 DeepSeek 搜索服务，`AUTHOR_MAX_OUTPUT=32768`，都开看图和工具。

## 题目（两个真实的一句话需求）

| 代号 | 用户原话 | 考什么 |
|---|---|---|
| water | 给小学三年级的孩子画一张图，讲清楚水是怎么在天上和地上循环的 | 插画与生图、画风统一、儿童可读性、科学准确 |
| silk | 帮我画一张古代丝绸之路的路线图，标出长安、敦煌、撒马尔罕这些主要城市 | 真实地图（`geomap`）、史实与地名、搜索、标注排版 |

## 价格（核实于 2026-11-02）

| 项目 | 新输入 | 缓存读 | 缓存写 | 输出 | 来源 |
|---|---|---|---|---|---|
| gpt-6.1-terra，Standard | $1 | $0.05 | $1.25（30 分钟） | $5 | [OpenAI 模型页](https://developers.openai.com/api/docs/models/gpt-6.1-terra)；Fast = 2×，Flex/Batch = 0.5× |
| claude-opus-5.5 | $4 | $0.20 | $5（5 分钟，1.25×） | $20 | Anthropic 官方价，OpenRouter 按原价转售（充值另收手续费） |
| claude-sonnet-5.5 | $2 | $0.20 | $2.50 | $10 | 同上 |
| deepseek-flash | $0.30 | $0.006 | — | $1.20 | [DeepSeek 价格页](https://api-docs.deepseek.com/quick_start/pricing)，高峰价；非高峰（UTC 01–04、06–10 点以外）减半 |
| gpt-image-2.5-flare | 文字 $5 / 图片 $8 | — | — | 图像 $30 | [OpenAI 模型页](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)；1024² 约 low 196 / medium 439 / high 1,756 输出 token（[APIYI 实测](https://docs.apiyi.com/en/news/gpt-image-2-5-launch)） |
| DeepSeek 搜索 / 读网页 | 每次 $0.00075 | | | | DeepSeek 价格页，2026-11-01 起按次计费 |

评测脚本把这些价格写进模型目录（`bench/bench.mts` 的 `PRICES`），DrawY 在每次运行开始时把价格冻结进 `run.prices`，费用由 `costOf(run.usage, run.prices)` 算出，与产品里账单的算法相同。

## 方法

- **部署**：本地起素材服务、截图服务、主程序（Node 25，Chromium 1440×900），数据放临时目录。
- **隔离**：每个“配置 × 题目”用一个新账号，避免后一次运行复用前一次生成的私人图片（上一份体验报告的三档共用账号，生图成本因此偏低）。
- **操作**：只发一句话；作者提问时统一回答“你来决定，按你觉得最合适的方式画就行。”（最多两次）；不追问。
- **用户看到的过程**：作品建好后，先用该账号在 Chromium（1440×900）里打开作品页，再发起运行，所以画室自动打开、画布随事件起稿，与真人等待时看到的一样；每 12 秒截一张，结束后等动画落定再截完成页。截图里能看到右下角选中的模型、强度、速度、搜索和生图模型。
- **记录**：`run.json`（步骤、用量、价格、耗时）、`trace.json`（每轮的强度与 token）、`work.json`（最终作品）、每个非空场景的 PNG、过程截图。`bench/images.py` 按每次运行自身时长的三分之一、三分之二取帧（快慢不同的模型按阶段对齐），转成报告用的 WebP。
- **质量评分**（看图逐项打分，1–5）：准确（事实、地名、科学过程）、立意是否一眼读得出、构图与工艺（排版、留白、字号、风格统一）、完整度（有无运行错误、缺图、占位）。综合分 = 准确 ×0.35 + 立意 ×0.25 + 工艺 ×0.25 + 完整 ×0.15。
- **推荐口径**：在质量不低于最佳配置 0.3 分以内的配置里，按“每张图成本 × 等待时间”取最优。

运行方法：

```sh
pnpm install && pnpm build
# 素材、截图、主程序三个服务（DRAWY_DATA 指向临时目录）
npx tsx docs/model-eval/bench/bench.mts --dry-run            # 看从环境变量组出的模型目录
npx tsx docs/model-eval/bench/bench.mts --tag baseline       # 4 配置 × 2 题，默认 4 路并行
npx tsx docs/model-eval/bench/summarize.mts docs/model-eval/runs/baseline
python3 -I docs/model-eval/bench/images.py docs/model-eval/runs/baseline docs/model-eval/img
```

截图服务和观看用的浏览器都需要能启动 Chromium；容器里预装的版本与 Playwright 1.64 要求的版本号不同时，把 `PLAYWRIGHT_BROWSERS_PATH` 指向一个用符号链接补上版本号的目录即可。

脚本已在本机完整跑通到“调用模型”这一步（注册、写入模型目录、建账号、选模型、建作品、发起运行、轮询、导出、汇总），四个配置都按环境变量落定了强度和速度；只差凭证。

## 静态成本分析（不依赖 Key，已实测）

每一轮模型请求都带着同一段前缀：

| 部分 | 字符数 | 说明 |
|---|---|---|
| 系统提示词 `AUTHOR` | 27,304 | 行为契约 |
| 素材目录 `catalogue()` | 35,515 | 21 个库画法的参数和示例数据、风格、质感 |
| 工具 schema | 11,939（独立搜索再加 955） | `write_work` 一个就占 4,547 |
| 合计 | ≈ 75k 字符，约 2 万 token | 每轮都重读；Claude 每个新用户的第一轮还要按 1.25× 写缓存 |

一次运行的钱花在五处：

1. **生图**：`images/index.ts` 固定 `quality: "auto"`、尺寸 1024²/1536×1024，每张还带最多 2 张风格参考图（图片输入 $8/M）。上一份报告里 Terra medium 档平均每个作品 3.7 张新图，生图约占总成本的 59%。
2. **输出 token**（含推理）：输出价是输入的 5 倍（Claude、Terra）。`write_work` 每次写出完整画法代码；Terra 的决策轮被升到 max，上一份报告里决策轮平均推理 1.3k–2.1k token，是执行轮的 3–5 倍。
3. **速度档**：Terra 当前是 fast，全部 token 价格 ×2。
4. **截图**：`view_canvas` 以 `detail: "high"` 送 1440×900 截图，留在上下文里之后每轮都重读（命中缓存时便宜，但 Claude 首次要写缓存）。
5. **缓存写入**（只有 Claude 和 Terra 计费）：每轮新增的工具结果、截图都按 1.25× 输入价写缓存。

## 降本方向（待用 5 次真实实验验证）

按预期节省从大到小。前三项不改变作者看到的内容，质量风险最低。

| # | 方向 | 怎么做 | 预期 | 质量风险 |
|---|---|---|---|---|
| A | 生图质量档 | `quality: "auto"` 改为按角色给档：插图 `medium`、图标 `low`，场景大图保留 `high` | 生图费 −50%～−75% | 中：小尺寸显示的插图看不出差别，大背景要看 |
| B | 关掉 Terra 的 fast | 默认速度改为 `default`，fast 留给愿意多付钱的人 | Terra 模型费 −50% | 无（只是更慢） |
| C | 少生图、多复用 | 提示词要求先 `find_materials` 再生图；风格参考图从 2 张降到 1 张 | 生图张数与图片输入费下降 | 低 |
| D | 决策轮强度 | Terra 开“决策轮沿用设置”，或只在第一次决策升 max、看图评判用设置档 | 输出 token −20%～−35% | 中：立意可能变平 |
| E | 精简前缀 | 素材目录只留一行简介，参数和示例由 `find_materials` 按需返回 | 每轮输入 −1 万 token；Claude 首轮缓存写入减半 | 中：作者可能更少用库画法 |
| F | 截图减负 | 细节视图用 `detail: "low"` 或降到 1280×800；只给最新两次截图配图 | 截图 token −40% | 低～中 |
| G | 混合模型 | 定立意和看图评判用强模型，写代码的执行轮用 DeepSeek Flash | 模型费可降一个数量级 | 高：两套缓存、协议互转，工程量大 |

5 次实验的打算：在基线跑完、选出推荐配置后，只对推荐配置做，每次两道题：① A；② B（若推荐 Terra）或 D；③ C；④ E；⑤ 前几项里有效的叠加在一起。每次比较总成本、耗时和看图评分，评分下降超过 0.3 的方向不采用。

## 阻塞

- 环境变量里只有各家的 `*_BASE_URL`、`*_MODEL`、强度和速度，没有 `*_API_KEY`；用 curl 和 Node fetch 经代理访问三家都得到 401（OpenAI：`Missing bearer authentication`；OpenRouter：`No cookie auth credentials`；DeepSeek：`Authentication Fails`），说明网络密钥也没有为这三个主机配置。
- 需要：在云环境设置的 **Network secrets** 里为 `api.openai.com`、`openrouter.ai`、`api.deepseek.com` 各加一条 Bearer 密钥（或加环境变量 `TERRA_API_KEY`、`OPUS_API_KEY`、`SONNET_API_KEY`、`DEEPSEEK_API_KEY`、`IMAGE_API_KEY`、`SEARCH_API_KEY`），然后新开会话。脚本两种方式都支持：有 `*_API_KEY` 就写进模型目录，没有就放占位符，由代理在出站时加上真实密钥。
- 预计花费：基线 8 次 + 实验约 10 次，按上一份报告的量级估计在 $5–10 之间（Opus 最贵）。
