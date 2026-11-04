import { it, expect } from "vitest";
import { stepBefore, versionsOf, type Cause, type RevisionSummary } from "./index.ts";

const history = (causes: Cause[]): RevisionSummary[] =>
  causes.map((cause, i) => ({ revision: i + 1, updatedAt: i, cause }));
const run = (runId: string): Cause => ({ kind: "run", runId, prompt: "ask " + runId });

it("counts one version for each request, however many drafts it saved", () => {
  // Two requests that saved twelve drafts between them, three hand edits, then a restore.
  const h = history([
    { kind: "create" },
    ...Array.from({ length: 8 }, () => run("a")),
    ...Array.from({ length: 4 }, () => run("b")),
    { kind: "edit" },
    { kind: "edit" },
    { kind: "edit" },
    { kind: "restore", revision: 9 },
  ]);
  const versions = versionsOf(h);
  expect(versions.map((v) => [v.number, v.cause.kind, v.revision, v.revisions.length])).toEqual([
    [0, "create", 1, 1],
    [1, "run", 9, 8],
    [2, "run", 13, 4],
    [3, "edit", 16, 3],
    [4, "restore", 17, 1],
  ]);
  // Order given does not matter.
  expect(versionsOf([...h].reverse())).toEqual(versions);
  // Undoing goes back a whole version; a restored version stands for the one it brought
  // back, so undoing it goes on before that one.
  expect(stepBefore(h, 16)).toBe(13);
  expect(stepBefore(h, 13)).toBe(9);
  expect(stepBefore(h, 17)).toBe(1);
  expect(stepBefore(h, 1)).toBeUndefined();
});
