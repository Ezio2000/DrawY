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
  "只有画法素材有预览": "Only drawing materials have previews",
  "请在模型设置中配置生图凭证":
    "Set up the image model's credentials in Settings",
  "请先配置模型凭证": "Set up the model's credentials in Settings first",
  "模型输出被截断，请缩小本轮作品修改范围":
    "The model's output was cut off; ask for a smaller change",
  "模型连接在完成前中断": "The connection to the model ended before it finished",
  "作品版本已更新，请重新读取": "The work has changed; reload it and try again",
  "作品需要一个根场景": "The work needs a root scene",
  "场景层级不能循环": "Scenes cannot contain themselves",
  "场景缺少父场景": "A scene is missing its parent",
  "场景交互不存在": "Scene interaction not found",
  "场景内 ID 重复": "Duplicate ID in the scene",
  "模块交互目标不存在": "Module interaction target not found",
  "连接锚点不存在": "Link anchor not found",
  "检查目标不存在": "Check target not found",
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
};

const patterns: [RegExp, (...m: string[]) => string][] = [
  [/^PlantUML 渲染失败: ([\s\S]*)$/, (d) => "PlantUML rendering failed: " + d],
  [/^画布查看服务不可用([\s\S]*)$/, (d) => "The canvas capture service is unavailable" + d],
  [/^生图失败 (\d+): ([\s\S]*)$/, (s, d) => `Image generation failed (${s}): ${d}`],
  [/^模型请求 (\d+): ([\s\S]*)$/, (s, d) => `Model request failed (${s}): ${d}`],
  [
    /^与模型的连接中断了（([\s\S]*)），已保存的内容仍可继续修改$/,
    (d) => `The connection to the model was lost (${d}); what was saved can still be edited`,
  ],
  [/^素材不存在: (.*)$/, (id) => "Material not found: " + id],
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
