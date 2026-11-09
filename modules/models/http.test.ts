import { expect, it } from "vitest";
import { localize } from "../contracts/messages.ts";
import { readable, streamError } from "./http.ts";

it("tells what a model service said went wrong in its own words, not its JSON", () => {
  const quota = {
    type: "insufficient_quota",
    code: "credit_balance_exhausted",
    message: "You have no credits remaining.",
    param: null,
  };
  expect(readable(JSON.stringify({ error: quota }))).toBe("You have no credits remaining. (credit_balance_exhausted)");
  expect(readable(quota)).toBe("You have no credits remaining. (credit_balance_exhausted)");
  expect(readable("<html>Bad gateway</html>")).toBe("<html>Bad gateway</html>");
  // Out of credit is not retried; a busy service is, as the status it stands for.
  expect(streamError(quota).message).toBe("模型服务报错：You have no credits remaining. (credit_balance_exhausted)");
  expect(localize(streamError(quota).message, "en")).toBe(
    "The model service reported an error: You have no credits remaining. (credit_balance_exhausted)",
  );
  expect(streamError({ code: "rate_limit_exceeded", message: "Slow down" }).message).toBe(
    "模型请求 429: Slow down (rate_limit_exceeded)",
  );
});
