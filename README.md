# DrawY

AI 创作可以探索和修改的图。界面沿用 SeeY；画布负责平移、缩放、选择、移动与调整模块大小，作品保存内容和画法。

作品包含六部分：`drawings` 保存 AI 编写的可复用绘制代码；`scenes` 用模块实例、分组和锚点连接组成场景；`interactions` 保存场景事件与动画；`details` 保存独立打开的说明；`resources` 引用图片素材；`style` 保存共享样式。实例包含自己的数据、位置、尺寸和导航目标。相同画法可用于多个实例，画法代码与实例数据分别修改。

画法接收 `api`，返回 DOM/SVG 元素。`api.svg/html` 创建局部内容，`api.mermaid/plantuml` 渲染结构化图，`api.resource` 引用素材，`api.emit` 触发场景事件。场景交互通过 `api.on/set/move/openScene/openDetail` 操作实例和导航；异步工作使用 async/await，动画与外部监听通过 `api.animate/cleanup` 管理生命周期。交互状态随场景离开而释放，持久数据通过 `write_work` 原子保存为新版本。画法由 AI 定义，产品没有预设图种注册表。

```sh
docker compose up -d --build
```

访问 http://localhost:8088。注册账号后在设置中配置绘制、视觉检查和生图模型；支持 OpenAI API Key 与 ChatGPT OAuth。绘制和检查各有独立的 Fast 与思考强度设置，生图模型单独选择。数据位于 `./data`；`DRAWY_PORT` 设置端口；可在本地 `.env` 中设置 `DRAWY_OUTBOUND_PROXY` 和 `DRAWY_NODE_OPTIONS`。

```sh
pnpm install
pnpm typecheck
pnpm test
```

`contracts` 定义作品协议；`workspace` 管理原子修改与版本；`runtime` 执行画法和场景交互；`canvas` 管理视角与编辑手势；`agent` 编排创作工具；`review` 用相同运行时获取整图、局部和交互截图，再交给视觉模型；`models/images/materials` 分别负责模型、生图与素材；`identity/storage` 按用户隔离账号、作品、版本、任务、素材和设置。

提示词参考 [GPT-6 Astra 官方指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)和 [Opus 5.5 官方指南](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)，保留明确的作品协议、简短工具约定和实际视觉验收。

主程序沿用 SeeY 的 MIT 授权；`materials` 和 `modules/ui/brand` 为原 SeeY Art 私有素材，保留独立授权。
