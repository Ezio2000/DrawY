# DeepSeek Responses 搜索预算依赖域名特化

记录日期：2026-11-03。当前处理随 PR #19 上线，提交 `e550658`。

## 现象与当前处理

DrawY 在搜索预算用完后，通过 Responses 的 `tool_choice: allowed_tools` 排除搜索工具，工具列表本身保持不变。DeepSeek 实现了 Responses，但不接受这个值，实际请求返回 HTTP 422：`unknown variant allowed_tools`；它也不支持 `max_tool_calls`。

当前 `modules/models/responses.ts` 的 `narrow` 根据连接地址的 hostname 是否为 `api.deepseek.com`，决定不发送上述两项。独立搜索执行器仍按每次运行最多 8 次、第一稿保存后最多 2 次检查预算，超额调用不会请求搜索服务。

## 待解决

这个判断绑定了 DeepSeek 官方域名。相同接口经自定义域名或代理接入时不会命中；其他缺少这些参数的 Responses 服务也不能通过配置声明差异。

后续应把收窄工具的能力表达在供应商配置和运行设置里，由适配器读取，并移除域名判断。OpenAI 保留当前请求级限制；不支持的服务继续由独立搜索执行器限制预算，不通过修改工具列表实现。

验收应覆盖官方与自定义地址、预算耗尽后继续创作、超额搜索不会执行，以及 OpenAI 的请求级限制保持有效。
