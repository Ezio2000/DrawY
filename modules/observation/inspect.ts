import { faults, labelOf, type Bounds, type Defects, type Fault, type Work } from "../contracts/index.ts";
import { tracer } from "../trace/index.ts";
import type { Shot } from "./capture.ts";

/** The visual check: a decision model shown the opening view of a scene, asked yes or no
 * about each fault a picture shows and the author cannot measure (a line through words,
 * labels on each other or on a box edge, two links run into one line), and which modules
 * and links are hurt. It sees only pixels and costs a fraction of a cent, so every look
 * asks it, and what it finds goes to the author by id beside the screenshot. */
export const INSPECT_MODEL = "google/gemini-decision-1";
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

/** Who pays for the check: a run's OpenRouter key, or the server's. */
export interface Inspector {
  credential: string;
}
/** The key a run checks with: the one its settings found, else the server's own. */
export function inspectorFrom(own?: Inspector): Inspector | undefined {
  if (own?.credential) return own;
  const credential = process.env.DRAWY_INSPECT_KEY || process.env.OPENROUTER_API_KEY;
  return credential ? { credential } : undefined;
}

/** A score at or above this is a fault: clean pictures stay below it. */
export const FAULT = 0.5;
/** A highest score at or above this, short of a fault, is looked at again by quarters, where
 * thin lines run together show up larger. */
export const DOUBT = 0.3;
/** A part is named when the check gives it at least this share, up to `NAMED` of them, so
 * one picture with two faults names both. */
export const CULPRIT = 0.15;
const NAMED = 3;
const MAX_CHOICES = 255;

const GATES: Record<Fault, string> = {
  text_pierce:
    "Does ANY line, arrow, or dashed curve pass across or touch ANY text characters (boxed or unboxed floating text)?",
  text_overlap:
    "Do two separate text labels overlap each other, or does an arrow label touch/overlap a box border?",
  line_merge:
    "Do two separate connector arrows merge collinearly into one shared overlapping line segment (forming a T-junction along a line)?",
};
/** What each fault is called when the author is told. */
const SAID: Record<Fault, string> = {
  text_pierce: "a line crosses or touches words",
  text_overlap: "labels overlap each other or touch a box edge",
  line_merge: "two links run together along one shared segment",
};

export interface Inspection {
  defects?: Defects;
  /** What it cost: the calls made and their price in US dollars. */
  calls: number;
  cost: number;
}

interface Part {
  id: string;
  says: string;
  /** Where it is in the screenshot, in pixels. */
  box: Bounds;
}
type Answers = Record<
  string,
  { type: "noul"; noul: number } | { type: "choice"; probabilities: Record<string, number> }
>;

/** The scene's modules and links as the check names them, with where each is on screen. */
function partsOf(work: Work, shot: Shot) {
  const scene = work.scenes[shot.sceneId];
  const words = shot.text?.words ?? {};
  const { x, y, scale } = shot.camera;
  const drawn = new Map((shot.modules ?? []).map((m) => [m.id, m.bounds]));
  const onScreen = (b: Bounds): Bounds => ({
    x: x + b.x * scale,
    y: y + b.y * scale,
    width: b.width * scale,
    height: b.height * scale,
  });
  const named = new Map(scene.modules.map((m) => [m.id, (words[m.id] ?? labelOf(m)).slice(0, 30)]));
  const modules: Part[] = scene.modules
    .map((m) => ({ id: m.id, says: named.get(m.id)!, box: onScreen(drawn.get(m.id) ?? m.bounds) }))
    // The parts with words come first: most faults are about words.
    .sort((a, b) => Number(!words[a.id]) - Number(!words[b.id]))
    .slice(0, MAX_CHOICES);
  const boxOf = (id: string) => modules.find((m) => m.id === id)?.box;
  const links: Part[] = scene.links.slice(0, MAX_CHOICES).flatMap((l) => {
    const ends = [boxOf(l.from.moduleId), boxOf(l.to.moduleId)].filter((b) => !!b);
    if (!ends.length) return [];
    const label = words[l.id] ? ` ('${words[l.id]}')` : "";
    return [
      {
        id: l.id,
        says: `${named.get(l.from.moduleId) ?? l.from.moduleId} -> ${named.get(l.to.moduleId) ?? l.to.moduleId}${label}`,
        box: hull(ends),
      },
    ];
  });
  return { modules, links };
}
const hull = (boxes: Bounds[]): Bounds => {
  const left = Math.min(...boxes.map((b) => b.x)),
    top = Math.min(...boxes.map((b) => b.y));
  return {
    x: left,
    y: top,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - left,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - top,
  };
};
const meets = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The questions for one picture. A choice needs two parts at least, and asks only which
 * part is hurt: whether anything is wrong is the gates' to say, since a "none" option would
 * draw off the share the parts compete for. Links are left out under two, where a merge
 * cannot happen and a lone link question only finds faults in pictures without any. */
export function questionsFor(parts: { modules: Part[]; links: Part[] }) {
  const linked = parts.links.length >= 2;
  const choice = (instructions: string, among: Part[]) => ({
    type: "choice",
    instructions,
    criteria: Object.fromEntries(among.map((p) => [p.id, p.says || p.id])),
  });
  return {
    has_text_pierce: { type: "noul", instructions: GATES.text_pierce },
    has_text_overlap: { type: "noul", instructions: GATES.text_overlap },
    ...(linked ? { has_line_merge: { type: "noul", instructions: GATES.line_merge } } : {}),
    ...(parts.modules.length >= 2
      ? {
          culprit_module: choice(
            "Which single module/text element is most visually affected (pierced text, colliding labels, or line passing behind it)?",
            parts.modules,
          ),
        }
      : {}),
    ...(linked
      ? {
          culprit_link: choice(
            "Which single connector line/arrow has the worst visual defect (piercing text, passing behind an unrelated box, label overlapping border, or merging collinearly into a shared segment)?",
            parts.links,
          ),
        }
      : {}),
  };
}

/** The gates' scores, by fault. */
const scoresOf = (answers: Answers) =>
  Object.fromEntries(
    faults.flatMap((fault) => {
      const a = answers["has_" + fault];
      return a?.type === "noul" ? [[fault, a.noul]] : [];
    }),
  ) as Partial<Record<Fault, number>>;
/** The parts a choice gives a real share to, most likely first. */
const culprits = (answers: Answers, key: string) => {
  const a = answers[key];
  if (a?.type !== "choice") return [];
  return Object.entries(a.probabilities)
    .filter(([, p]) => p >= CULPRIT)
    .sort((x, y) => y[1] - x[1])
    .slice(0, NAMED);
};
/** What one picture's answers found, with each named part's share. */
function found(answers: Answers) {
  const scores = scoresOf(answers);
  const seen = faults.filter((f) => (scores[f] ?? 0) >= FAULT);
  if (!seen.length) return undefined;
  return { faults: seen, modules: culprits(answers, "culprit_module"), links: culprits(answers, "culprit_link") };
}
/** Several pictures' findings as one, each part at the largest share it was given. */
function merged(all: NonNullable<ReturnType<typeof found>>[]): Defects | undefined {
  if (!all.length) return undefined;
  const ranked = (lists: [string, number][][]) => {
    const best = new Map<string, number>();
    for (const [id, p] of lists.flat()) best.set(id, Math.max(p, best.get(id) ?? 0));
    return [...best].sort((a, b) => b[1] - a[1]).slice(0, NAMED).map(([id]) => id);
  };
  return {
    faults: faults.filter((f) => all.some((a) => a.faults.includes(f))),
    modules: ranked(all.map((a) => a.modules)),
    links: ranked(all.map((a) => a.links)),
  };
}

/** Checks a scene's opening view. A failed check is left out of the look rather than
 * spoiling it: the author still sees the picture. */
export async function inspect(
  inspector: Inspector,
  work: Work,
  shot: Shot,
  signal: AbortSignal,
): Promise<Inspection | undefined> {
  if (!shot.plain || !work.scenes[shot.sceneId]?.modules.length) return undefined;
  const parts = partsOf(work, shot);
  const spent = { calls: 0, cost: 0 };
  const ask = (base64: string, among: typeof parts, view: string) =>
    tracer.span("tool", "inspect", { meter: "inspect", sceneId: shot.sceneId, view }, async (span) => {
      const questions = questionsFor(among);
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${inspector.credential}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: INSPECT_MODEL,
          state: [
            "Inspect this auto-trimmed diagram purely for visual defects (ignore domain logic).",
            { type: "image_url", image_url: { url: "data:image/png;base64," + base64, detail: "high" } },
          ],
          questions,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok)
        throw Error(`视觉检查 ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const { answers, usage } = (await response.json()) as {
        answers: Answers;
        usage?: { input_tokens?: number; cost?: number };
      };
      spent.calls++;
      spent.cost += usage?.cost ?? 0;
      span.set({ answers, usage: { input_tokens: usage?.input_tokens ?? 0 }, cost: usage?.cost });
      return answers;
    });
  try {
    const whole = await ask(shot.plain.base64, parts, "whole");
    const top = Math.max(0, ...Object.values(scoresOf(whole)));
    let defects = merged([found(whole)].filter((f) => !!f));
    if (!defects && top >= DOUBT) {
      // A doubt is looked at again by quarters, each asked about the parts it shows.
      const quarters = await Promise.all(
        shot.plain.quarters.map((q, i) =>
          ask(
            q.base64,
            {
              modules: parts.modules.filter((p) => meets(p.box, q.frame)),
              links: parts.links.filter((p) => meets(p.box, q.frame)),
            },
            `quarter ${i + 1}`,
          ),
        ),
      );
      defects = merged(quarters.map(found).filter((f) => !!f));
    }
    return { ...(defects ? { defects } : {}), ...spent };
  } catch (e) {
    signal.throwIfAborted();
    return spent.calls ? spent : undefined;
  }
}

/** A look's findings, as the author reads them beside the screenshot. */
export function defectsSaid(work: Work, sceneId: string, d: Defects) {
  const scene = work.scenes[sceneId];
  const module = (id: string) => scene.modules.find((m) => m.id === id);
  const link = (id: string) => scene.links.find((l) => l.id === id);
  return {
    note: "A visual check of this picture, which sees only pixels and is sometimes wrong. Look at each part it names and fix it unless you can see it is clean. The user does not know about the check, so its findings stay out of your notes and closing words.",
    seen: d.faults.map((f) => SAID[f]),
    ...(d.modules.length ? { modules: d.modules.filter((id) => module(id)) } : {}),
    ...(d.links.length
      ? {
          links: d.links.flatMap((id) => {
            const l = link(id);
            return l ? [`${id} (${l.from.moduleId} → ${l.to.moduleId})`] : [];
          }),
        }
      : {}),
  };
}
