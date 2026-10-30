import { serve } from "@hono/node-server";
import { Storage } from "../../modules/storage/index.ts";
import { createApp } from "./app.ts";
import { tracer } from "../../modules/trace/index.ts";
const data = process.env.DRAWY_DATA || "data";
const storage = new Storage(data);
tracer.open(data);
for (const row of storage.db.prepare("SELECT user_id,data FROM runs").all()) {
  const run = JSON.parse(row.data as string);
  if (["running", "viewing"].includes(run.status)) {
    run.status = "failed";
    run.error = "服务重启中断了本次任务，已保存的内容仍可继续修改";
    storage.scoped(row.user_id as string).saveRun(run);
    tracer.status(run.id, run.status);
  }
}
const { app } = createApp(storage);
serve({
  fetch: app.fetch,
  hostname: "0.0.0.0",
  port: Number(process.env.PORT || 8080),
});
