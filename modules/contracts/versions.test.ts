import { it, expect } from "vitest";
import { historyOf, stepBefore, versionsOf, type Cause, type RevisionSummary } from "./index.ts";

const history = (causes: Cause[]): RevisionSummary[] =>
  causes.map((cause, i) => ({ revision: i + 1, updatedAt: i, cause }));
const run = (runId: string): Cause => ({ kind: "run", runId, prompt: "ask " + runId });

it("counts one version for each request, however many drafts it saved", () => {
  // Two requests that saved twelve drafts between them, then three hand edits saved as one.
  const h = history([
    { kind: "create" },
    ...Array.from({ length: 8 }, () => run("a")),
    ...Array.from({ length: 4 }, () => run("b")),
    { kind: "edit" },
    { kind: "edit" },
    { kind: "save" },
  ]);
  const versions = versionsOf(h);
  expect(versions.map((v) => [v.number, v.cause.kind, v.revision, v.revisions.length])).toEqual([
    [0, "create", 1, 1],
    [1, "run", 9, 8],
    [2, "run", 13, 4],
    [3, "save", 16, 3],
  ]);
  // Order given does not matter.
  expect(versionsOf([...h].reverse())).toEqual(versions);
  // Undoing goes back a whole version.
  expect(stepBefore(h, 16)).toBe(13);
});

it("goes back to a version instead of making a new one, and forward again", () => {
  const h = history([{ kind: "create" }, run("a"), run("b"), run("c")]);
  const back = [...h, { revision: 5, updatedAt: 5, cause: { kind: "restore", revision: 2 } as Cause }];
  // Version 1 is the latest again; 2 and 3 leave the list.
  expect(versionsOf(back).map((v) => [v.number, v.revision, v.revisions])).toEqual([
    [0, 1, [1]],
    [1, 2, [2, 5]],
  ]);
  expect(stepBefore(back, 5)).toBe(1);
  // The next request is version 2.
  const next = [...back, { revision: 6, updatedAt: 6, cause: run("d") }];
  expect(versionsOf(next).map((v) => [v.number, v.revision])).toEqual([
    [0, 1],
    [1, 2],
    [2, 6],
  ]);
  // Going back to a version that had left the list brings it back with those under it.
  const forward = [...back, { revision: 6, updatedAt: 6, cause: { kind: "restore", revision: 4 } as Cause }];
  expect(versionsOf(forward).map((v) => [v.number, v.revision])).toEqual([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
  ]);
});

it("keeps hand edits out of the versions until they are saved as one", () => {
  const draft: Cause = { kind: "edit" };
  const h = history([{ kind: "create" }, run("a"), draft, draft, draft]);
  const { versions, unsaved } = historyOf(h);
  expect(versions.map((v) => v.number)).toEqual([0, 1]);
  expect(unsaved.map((e) => e.revision)).toEqual([3, 4, 5]);
  // Undoing takes back one edit at a time, then the version before.
  expect(stepBefore(h, 5)).toBe(4);
  expect(stepBefore(h, 3)).toBe(2);
  // Undone, an edit is gone; brought back, it is there again.
  const undone = [...h, { revision: 6, updatedAt: 6, cause: { kind: "restore", revision: 4 } as Cause }];
  expect(historyOf(undone).unsaved.map((e) => e.revisions)).toEqual([[3], [4, 6]]);
  expect(stepBefore(undone, 6)).toBe(3);
  const redone = [...undone, { revision: 7, updatedAt: 7, cause: { kind: "restore", revision: 5 } as Cause }];
  expect(historyOf(redone).unsaved.map((e) => e.revisions)).toEqual([[3], [4, 6], [5, 7]]);
  // Thrown away, the version they were made on is the latest again.
  const dropped = [...h, { revision: 6, updatedAt: 6, cause: { kind: "restore", revision: 2 } as Cause }];
  expect(historyOf(dropped)).toEqual({
    versions: [
      expect.objectContaining({ number: 0 }),
      expect.objectContaining({ number: 1, revisions: [2, 6] }),
    ],
    unsaved: [],
  });
  // Saved, they are one version; edits saved one after another are versions of their own.
  const saved = history([{ kind: "create" }, run("a"), draft, draft, { kind: "save" }, draft, { kind: "save" }]);
  expect(historyOf(saved)).toEqual({
    versions: [
      expect.objectContaining({ number: 0 }),
      expect.objectContaining({ number: 1 }),
      expect.objectContaining({ number: 2, cause: { kind: "save" }, revisions: [3, 4, 5] }),
      expect.objectContaining({ number: 3, cause: { kind: "save" }, revisions: [6, 7] }),
    ],
    unsaved: [],
  });
  // A request made on edits not saved takes them into its version.
  const asked = history([{ kind: "create" }, run("a"), draft, run("b")]);
  expect(versionsOf(asked).at(-1)).toMatchObject({ number: 2, revisions: [3, 4] });
});
