import { expect, it } from "vitest";
import { Clipboard } from "./session/clip.ts";
import { fitting } from "./shells.ts";
import { memoryStorage } from "./storage.ts";

const pages = [
  ["phone", "(max-width: 760px), (pointer: coarse) and (max-width: 1100px)"],
  ["desktop", null],
] as const;

it("picks the page whose query the device matches, and the one without a query otherwise", () => {
  const narrow = (q: string) => q.startsWith("(max-width: 760px)");
  expect(fitting([...pages], narrow)).toBe("phone");
  expect(fitting([...pages], () => false)).toBe("desktop");
  expect(fitting([["desktop", null]], () => true)).toBe("desktop");
});

it("keeps the parts copied in the storage it is given, for other tabs to paste", () => {
  const storage = memoryStorage();
  const clip = { kind: "drawy/clip", workId: "w", sceneId: "root", modules: [], links: [], drawings: [], materials: [] };
  const one = new Clipboard(storage);
  expect(one.get()).toBe(false);
  one.keep(clip as never);
  expect(one.get()).toBe(true);
  const other = new Clipboard(storage);
  expect(other.get()).toBe(true);
  expect(other.kept()?.workId).toBe("w");
});
