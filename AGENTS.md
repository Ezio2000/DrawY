# AGENTS.md

首页的风格参考入口在 `apps/web/src/home/Landing.tsx`。示例由真实 DrawY 请求的输入和导出成稿组成，进入视口时按压缩时间回放选图、输入和显影，支持暂停、重播和减少动效。上传按钮把单张图片交给现有的 `asking.upload`，复用访客登录与附件上传。返回首屏输入框时只给空草稿补提示词，已有文字保留。此入口通过附件和用户指令表达画风参考。

DrawY 是一个让 AI 画可探索、可修改的图的 Web 应用。用户提出请求后，“作者”（创作模型）先定下创作简报，再用工具写出作品：可复用的画法代码、由模块实例组成的场景、交互脚本。浏览器运行时执行这些代码，截图服务把画面拍下来送回作者，作者看过后继续改。产品里没有预设的图种，所有画法都由作者编写，所以大多数改动都会落在“作品协议、作者的工具与提示词、运行时 API”这条链上。

用户可见的行为变化时，更新 README 的产品说明。实现或架构变化时，更新[开发文档](docs/architecture.md)的对应章节。

## 命令

这是一个 pnpm workspace，`materials` 是 `@drawy/materials`（素材服务），`content` 是策展素材的内容项目（只产出素材包，应用不读它）。运行需要 Node 25，存储依赖它内置的 `node:sqlite`。TypeScript 由 tsx 直接执行，不预编译。

```sh
pnpm install
pnpm typecheck                                    # tsc --noEmit；项目没有 linter
pnpm build                                        # dist/web（前端）与 dist/runtime/runtime.js（运行时 IIFE）
pnpm test                                         # 只跑核心单测（不 build、不跑浏览器回归，默认验证只跑这个即可）
pnpm test:runtime                                 # 先打 runtime bundle 再跑 modules/runtime/runtime.test.ts
pnpm test:desktop                                 # 先 build 再只跑作品页（电脑、手机、平板）的回归验证（按需手动跑）
pnpm exec vitest run modules/agent/agent.test.ts  # 单个文件
pnpm exec vitest run -t "用例名片段"               # 单个用例
docker compose up -d --build                      # 完整部署，访问 http://localhost:8088
```

默认验证只跑核心单测（`pnpm test`）即可，不依赖构建产物。`modules/runtime/runtime.test.ts` 会加载 `dist/runtime/runtime.js` 并在 Playwright Chromium 里执行（改了 `modules/runtime`、`modules/observation/capture.ts` 或相关协议需要验证时跑 `pnpm test:runtime`）。`apps/web/regression/` 下的作品页回归验证测的是构建出的 `dist/web`，耗时较长，仅在需要时手动跑 `pnpm test:desktop`。Playwright 自带的浏览器没装时，可用 `DRAWY_CHROMIUM` 指定一个 Chromium 可执行文件。

本地开发要同时起几个进程：
- 先构建并导入素材包（重复导入同一版本无副作用）：`pnpm --dir content build /tmp/drawy-pack` 和 `pnpm --dir materials library import /tmp/drawy-pack`。
- `pnpm --dir materials start`：素材服务，端口 8090，数据在 `data/materials`；启动不读素材包。
- `pnpm exec tsx apps/capture/main.ts`：截图服务，端口 8091。
- `pnpm server`：主程序，端口 8080，数据在 `data`，同时提供 `dist/runtime` 和 `dist/web` 的静态文件。
- `pnpm dev`：Vite 前端，把 `/api`、`/materials`、`/runtime` 代理到 8080。

主程序用 `hono/compress` 压缩文本响应（SSE 和图片不压），`/assets/*` 带内容哈希，按 immutable 长期缓存。

服务地址可以用 `DRAWY_MATERIALS_URL`、`DRAWY_CAPTURE_URL`、`DRAWY_INTERNAL_URL` 覆盖，其中最后一个是截图服务回访主程序的地址。`data/` 存的是真实的用户数据，测试和调试时用临时目录，不要清理或改写它。截图镜像只复制它用到的文件，`capture.ts` 多依赖一个文件就要在 `Dockerfile` 的 capture 阶段加上。

## 按任务查阅

- [运行循环、作者工具、截图、版本和导出](docs/architecture.md#一次运行如何流动)
- [模型适配器、搜索预算、生图和计费](docs/architecture.md#创作搜索与生图的组合)
- [账号权限、登录和模型设置](docs/architecture.md#账号角色与模型)
- [桌面、手机、平板界面和浏览器回归](docs/architecture.md#前端的分层)
- [选区、拖动、编辑面板和保存](docs/architecture.md#手动编辑如何流动)
- [模块边界、素材服务和地图数据](docs/architecture.md#模块职责)
- [作品协议、提示词、视觉规范和测试](docs/architecture.md#改动时需要知道的约束)

## 跨模块约定

- 作者工具和手动编辑共用 `WorkEdit`。改作品协议时，从 `modules/contracts` 定义追到两类写入、作品读回和运行时渲染。涉及存储格式时，按开发文档处理已存作品、修订和作者对话。
- 改作者提示词时，先读 `modules/agent/prompts.ts` 文件头的模型指南。每件作品都用到的规则放在稳定的系统提示词或工具说明里，特定任务的知识放在 `guides.ts` 或画法卡片里。
- 用户可见文案保持中英双语。前端文案在 `apps/web/src/i18n.tsx`，服务端错误翻译在 `modules/contracts/messages.ts`。
