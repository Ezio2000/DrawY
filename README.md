# DrawY

AI 绘制 HTML、Mermaid、PlantUML，可检索素材、生成与编辑图片，并对实际页面截图进行视觉检查。界面沿用 SeeY，作品和模型设置按个人账号隔离。

```sh
docker compose up -d --build
```

访问 http://localhost:8088，注册账号，在设置里分别配置绘制、视觉检查和生图账号。支持 OpenAI API Key 与 ChatGPT OAuth（access token，必要时提供 account ID）。生图使用独立模型。数据保存在 `./data`；`DRAWY_PORT` 可修改对外端口。

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

模块职责见目录命名：`runtime` 渲染页面，`workspace` 管理版本，`agent` 编排工具，`review` 检查截图，`images` 对接生图，`materials` 检索素材，`identity` 管理会话，`storage` 保存用户数据。每层页面通过 `data-drawy-id` 标记选区、`data-drawy-open` 标记子页入口、`data-drawy-diagram` 引用图表。无旧版数据导入、分享、导出或 MCP。

主程序沿用 SeeY 的 MIT 授权；`materials` 和 `modules/ui/brand` 为原 SeeY Art 私有素材，保留独立授权，不属于 MIT 范围。

本机有出站代理时，可在不入库的 `.env` 中设置 `DRAWY_OUTBOUND_PROXY`；`DRAWY_NODE_OPTIONS` 用于 Node 运行参数。二者默认均为空。截图服务通过 Compose 内部的 `drawy-app` 地址访问作品。

异步页面脚本使用 `window.drawy.waitUntil(promise)` 注册加载任务，视觉检查会等待任务与字体、图片加载完成。模型客户端位于独立的 `models` 模块，供生成、生图与检查复用。

绘制与视觉检查各有独立的 Fast 开关，默认关闭。开启后以 `service_tier: "priority"` 请求优先处理，关闭后明确使用 `default`；思考强度单独设置。API 与 ChatGPT OAuth 均支持该请求选项，实际可用性与额度计费由所选服务和模型决定。
