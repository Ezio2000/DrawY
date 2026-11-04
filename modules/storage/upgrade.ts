import { sideOf, sidePoint } from "../contracts/geometry.ts";
import type { Instance, Link, LinkEnd, Scene, Side, Work } from "../contracts/index.ts";
import { labelOf } from "../contracts/index.ts";

/* Saved works in the form before links held their own ends. Each is brought to today's form
 * when the database opens, so nothing else reads the old one (see Storage.upgradeWorks). */

/** The database format this code reads. */
export const WORK_FORMAT = 2;
interface OldModule extends Omit<Instance, "group" | "target" | "label"> {
  label?: string;
  group?: string | null;
  target?: Instance["target"] | null;
  anchors?: Record<string, { x: number; y: number }>;
}
interface OldEnd {
  moduleId: string;
  anchor: string;
}
interface OldLink extends Omit<Link, "from" | "to"> {
  from: OldEnd;
  to: OldEnd;
}
interface OldScene extends Omit<Scene, "modules" | "links" | "interaction"> {
  modules: OldModule[];
  links: OldLink[];
  interactionId?: string | null;
}
export interface OldWork extends Omit<Work, "scenes"> {
  scenes: Record<string, OldScene>;
  interactions?: Record<string, { id: string; source: string }>;
}
/** The end of a link at the place its anchor named: the side when it was the middle of one,
 * otherwise the point. An anchor that was missing drew at the module's middle, and still does. */
function endOf(end: OldEnd, modules: Map<string, OldModule>): LinkEnd {
  const a = modules.get(end.moduleId)?.anchors?.[end.anchor] ?? { x: 0.5, y: 0.5 };
  const side = sideOf(a) as Side | null;
  const middle = side && sidePoint[side];
  return {
    moduleId: end.moduleId,
    at:
      middle && Math.abs(a.x - middle.x) < 0.02 && Math.abs(a.y - middle.y) < 0.02
        ? side!
        : [a.x, a.y],
  };
}
function upgradeModule(m: OldModule): Instance {
  const { anchors: _, group, target, label, ...rest } = m;
  const words = labelOf({ id: m.id, data: m.data });
  return {
    ...rest,
    // A name that only repeats the module's words is no name of its own.
    ...(label && label !== words ? { label } : {}),
    ...(group ? { group } : {}),
    ...(target ? { target } : {}),
  };
}
/** A saved work in today's form. It draws exactly as it did: every link keeps the place it
 * met its module, and every scene its script. */
export function upgradeWork(old: OldWork): Work {
  const { interactions = {}, ...work } = old;
  const scenes = Object.fromEntries(
    Object.values(old.scenes).map((s) => {
      const { interactionId, ...scene } = s;
      const modules = new Map(s.modules.map((m) => [m.id, m]));
      const source = interactionId ? interactions[interactionId]?.source : undefined;
      return [
        s.id,
        {
          ...scene,
          modules: s.modules.map(upgradeModule),
          links: s.links.map((l) => ({
            ...l,
            from: endOf(l.from, modules),
            to: endOf(l.to, modules),
          })),
          ...(source ? { interaction: source } : {}),
        } satisfies Scene,
      ];
    }),
  );
  return { ...work, scenes } as Work;
}
