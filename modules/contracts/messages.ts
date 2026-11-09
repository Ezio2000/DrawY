/* What the server says to people, in English as well as Chinese. The server speaks Chinese
 * internally (the author and its retries read those words), and a message is put into the
 * reader's language where it leaves: an HTTP error by the request's language, a run's error
 * where the page shows it. Messages written for the model stay as they are. */

export type MessageLocale = "zh" | "en";

const exact: Record<string, string> = {
  请先登录: "Please log in first",
  请先取消当前任务: "Cancel the current task first",
  请先完成或取消当前任务: "Finish or cancel the current task first",
  当前任务没有等待回答: "The current task isn't waiting for an answer",
  场景不存在: "Scene not found",
  没有可以撤销的修改: "There is nothing to undo",
  没有要保存的修改: "There are no changes to save",
  模块不存在: "Module not found",
  资源不存在: "Not found",
  请选择图片: "Choose an image",
  "无法读取这张图片，请换一张": "This image can't be read; try another one",
  请上传图片: "Upload an image",
  没有这张图: "Image not found",
  没有这次运行的记录: "No record of this run",
  "服务重启中断了本次任务，已保存的内容仍可继续修改":
    "A server restart interrupted this task; what was saved can still be edited",
  "没有可查看的场景": "There is no scene to view",
  "截图服务没有返回画面": "The capture service returned no picture",
  "请输入用户名和至少六位密码":
    "Enter a username and a password of at least 6 characters",
  "用户名已存在": "That username is already taken",
  "用户名或密码错误": "Wrong username or password",
  请输入邀请码: "Enter an invite code",
  邀请码无效或已被使用: "That invite code is invalid or has already been used",
  邀请码不存在: "Invite code not found",
  "邀请码已被使用，不能删除": "A used invite code can't be removed",
  "一次可以生成 1 到 50 个邀请码": "You can make 1 to 50 invite codes at a time",
  "只有画法素材有预览": "Only drawing materials have previews",
  "请在模型设置中配置生图凭证":
    "Set up the image model's credentials in Settings",
  "请先配置模型凭证": "Set up the model's credentials in Settings first",
  "模型的思考用完了这一轮的输出额度，还没写出内容；可以调低思考强度再试":
    "The model used up this turn's output budget thinking before writing anything. Try a lower thinking effort.",
  "这一轮要写的内容太多，模型的输出被截断了":
    "There was too much to write in one go, and the model's output was cut off",
  // Runs saved before this wording still carry the old one.
  "模型输出被截断，请缩小本轮作品修改范围":
    "The model's output was cut off; ask for a smaller change",
  "模型连接在完成前中断": "The connection to the model ended before it finished",
  模型拒绝了这一轮的内容: "The model refused this turn's content",
  "模型 ID 重复": "Two models have the same ID",
  默认模型不存在: "The default model doesn't exist",
  "生图模型 ID 重复": "Two picture models have the same ID",
  默认生图模型不存在: "The default picture model doesn't exist",
  "搜索服务 ID 重复": "Two search services have the same ID",
  默认搜索服务不存在: "The default search service doesn't exist",
  "只能打开 http 或 https 网址": "Only http and https pages can be opened",
  "作品版本已更新，请重新读取": "The work has changed; reload it and try again",
  "作品需要一个根场景": "The work needs a root scene",
  "场景层级不能循环": "Scenes cannot contain themselves",
  "场景内模块 ID 重复": "Two modules in the scene have the same ID",
  "场景内连线 ID 重复": "Two links in the scene have the same ID",
  "根场景不能删除": "The root scene can't be removed",
  "交互操作需要指定 sceneId": "Interactions need a sceneId",
  "请先完成根场景": "Finish the root scene first",
  "运行超过 15 分钟": "The run took longer than 15 minutes",
  "生成被中断": "Generation was interrupted",
  "需要用户身份": "A user is required",
  "素材仍在生成": "The material is still being generated",
  "素材生成失败": "The material failed to generate",
  "素材 ID 已存在": "That material ID already exists",
  "素材不在生成中": "The material isn't being generated",
  没有权限: "You don't have permission to do that",
  角色不存在: "Role not found",
  账号不存在: "Account not found",
  至少要保留一位管理员: "Keep at least one administrator",
  管理员角色不能修改: "The administrator role can't be changed",
  内置角色不能删除: "Built-in roles can't be removed",
  角色名称已存在: "A role with that name already exists",
  没有查看其他用户素材的权限: "You can't see other users' materials",
  精选素材始终公开: "Curated materials are always public",
  "请先用 set_brief 确定风格，再生成图片":
    "Settle the brief and style before generating images",
  "局部查看和交互操作需要指定 sceneId": "Close-ups and clicks need a sceneId",
  "宽和高必须大于 0": "Width and height must be greater than 0",
  图片之间的引用不能循环: "Pictures in one request can't refer to each other in a circle",
};

const patterns: [RegExp, (...m: string[]) => string][] = [
  [/^模型服务中止了这一轮的输出：(.+)$/, (reason) => `The model service stopped this turn's output: ${reason}`],
  [/^模型服务中止了这一轮的输出：(.+)$/, (reason) => `The model service stopped this turn's output: ${reason}`],
  [/^画布查看服务不可用([\s\S]*)$/, (d) => "The canvas capture service is unavailable" + d],
  [/^生图失败 (\d+): ([\s\S]*)$/, (s, d) => `Image generation failed (${s}): ${d}`],
  [/^模型请求 (\d+): ([\s\S]*)$/, (s, d) => `Model request failed (${s}): ${d}`],
  [/^模型服务报错：([\s\S]*)$/, (d) => `The model service reported an error: ${d}`],
  [
    /^与模型的连接中断了（([\s\S]*)），已保存的内容仍可继续修改$/,
    (d) => `The connection to the model was lost (${d}); what was saved can still be edited`,
  ],
  [/^素材不存在: (.*)$/, (id) => "Material not found: " + id],
  [
    /^工具参数不是有效的 JSON（([\s\S]*)），没有保存(。请改正后把完整参数重发)?$/,
    (d, whole) => `The tool input wasn't valid JSON (${d}), so nothing was saved${whole ? ". Send the whole input again, corrected" : ""}`,
  ],
  [/^(.+)（还有 (\d+) 处问题）$/, (first, n) => `${localize(first, "en")} (and ${n} more)`],
  [/^场景 (\S+) 是新的，要给 title$/, (id) => `Scene ${id} is new and needs a title`],
  [/^连线 (\S+) 的一端 (\S+) 不在场景 (\S+) 里；这个场景有 (.*)$/, (id, m, scene, all) => `Link ${id} has an end at ${m}, which is not in scene ${scene}; it has ${all.replaceAll("、", ", ")}`],
  [/^(模块|连线) (\S+) 的画法 (\S+) 不存在：/, (kind, id, d) => `${kind === "模块" ? "Module" : "Link"} ${id} uses drawing ${d}, which doesn't exist`],
  [/^模块 (\S+) 点开的(场景|详情) (\S+) 不存在$/, (id, kind, t) => `Module ${id} opens ${kind === "场景" ? "scene" : "detail"} ${t}, which doesn't exist`],
  [/^检查的模块 (\S+) 不在场景 (\S+) 里$/, (id, scene) => `The check's module ${id} is not in scene ${scene}`],
  [/^场景 (\S+) 缺少父场景 ?(.*)$/, (id, parent) => `Scene ${id} is missing its parent ${parent}`.trim()],
  [/^场景 (\S+) 还没有交互脚本/, (id) => `Scene ${id} has no script to change yet`],
  [/^(模块|连线) (\S+) 已在场景 (\S+) 里/, (kind, id, scene) => `${kind === "模块" ? "Module" : "Link"} ${id} is already in scene ${scene}`],
  [/^(模块|连线) (\S+) 是新增的，要给全 ([^（]*)（/, (kind, id, fields) => `${kind === "模块" ? "Module" : "Link"} ${id} is new and needs all of: ${fields.replaceAll("、", ", ")}`],
  [/^画法 (\S+) 是新增的/, (id) => `Drawing ${id} is new and needs its source, or from`],
  [/^画法 (\S+) 要复制的 (\S+) 不存在/, (id, from) => `Drawing ${id} copies ${from}, which doesn't exist`],
  [/^详情 (\S+) 是新增的/, (id) => `Detail ${id} is new and needs a title and html`],
  [/^素材 (\S+) 不存在/, (id) => `Material ${id} doesn't exist`],
  [/^图片素材 (\S+) 不存在/, (id) => `Picture ${id} doesn't exist`],
  [/^代码有语法错误：([\s\S]*)$/, (d) => `The code has a syntax error: ${d}`],
  [/^找不到 (.*?)(；最接近的一段是 .*)?$/, (what) => `Could not find ${what}`],
  [/^(.*) 出现了 (\d+) 次/, (what, n) => `${what} occurs ${n} times`],
  [/^不认识的字段 (.*)$/, (keys) => `Unknown field ${keys.replaceAll("、", ", ")}`],
  [/^没有等待修正的写入/, () => "There is no refused write to amend"],
  [/^参考图不存在: (.*)$/, (ids) => "Reference pictures not found: " + ids],
  [/^参考图 (\S+) 没有生成成功$/, (id) => `Reference picture ${id} did not develop`],
  [/^场景 (\S+) 不存在：新场景写在 scenes 里$/, (id) => `Scene ${id} doesn't exist; new scenes go in scenes`],
  [/^(.+) 只有 (\d+) 项，没有位置 (\d+)$/, (list, n, place) => `${list} has ${n} items and no position ${place}`],
  [/^order 里的模块 (\S+) 不在场景 (\S+) 里$/, (id, scene) => `Module ${id} in order is not in scene ${scene}`],
  [/^没有这份地理数据: (.*)$/, (layer) => "No geographic data named " + layer],
  [/^没有这块街道数据: (.*)$/, (tile) => "No street tile " + tile],
  [/^街道数据读取失败: ([\s\S]*)$/, (d) => "Street data could not be read: " + d],
  [/^(\S+) 不是图片素材$/, (id) => `${id} is not a picture`],
  [/^未知风格 (\S+)，可用：(.*)$/, (id, all) => `Unknown style ${id}; available: ${all}`],
  [/^已达到本轮 (\d+) 次生成上限$/, (n) => `Reached this run's limit of ${n} generations`],
];

/** `message` in `locale`; one it does not know stays as it is. */
export function localize(message: string, locale: MessageLocale): string {
  // A stringified error carries its class, "Error: …", which says nothing to a person.
  const text = message.replace(/^(?:\w*Error|Unavailable): /, "");
  if (locale === "zh") return text;
  if (Object.hasOwn(exact, text)) return exact[text];
  for (const [re, say] of patterns) {
    const m = text.match(re);
    if (m) return say(...m.slice(1));
  }
  return text;
}

/** The language a request asks for: the page's choice, sent with each request, else the
 * browser's Accept-Language. */
export function requestLocale(
  header: (name: string) => string | undefined,
): MessageLocale {
  const chosen = header("x-drawy-locale");
  if (chosen === "zh" || chosen === "en") return chosen;
  const accept = header("accept-language")?.toLowerCase() ?? "";
  return !accept || accept.startsWith("zh") ? "zh" : "en";
}
