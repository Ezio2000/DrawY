import { serve } from "@hono/node-server";
import { Storage } from "../../modules/storage/index.ts";
import { createApp } from "./app.ts";
const storage = new Storage(process.env.DRAWY_DATA || "data");
for (const row of storage.db.prepare("SELECT user_id,data FROM runs").all()) {
  const run = JSON.parse(row.data as string);
  if (["running", "reviewing"].includes(run.status)) {
    run.status = "failed";
    run.error = "服务重启中断了本次任务，已保存的内容仍可继续修改";
    storage.scoped(row.user_id as string).saveRun(run);
  }
}
const { app } = createApp(storage);
serve({
  fetch: app.fetch,
  hostname: "0.0.0.0",
  port: Number(process.env.PORT || 8080),
});
