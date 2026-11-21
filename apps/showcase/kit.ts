import { readFileSync } from "node:fs";
import type { Brief, MaterialUse, Work, WorkEdit } from "../../modules/contracts/index.ts";

/* The works the home page shows. Each is written the way the author writes one: a brief,
 * then edits in the one form every write to a work takes (WorkEdit), laid on a work by the
 * server as it lays the author's write_work. `build.ts` sends them to a running DrawY and
 * keeps what comes back, so what the home page embeds is a work DrawY made and its runtime
 * draws, not a picture of one. */

export type Lang = "zh" | "en";
/** Picks the words for the language being built. */
export type Say = (zh: string, en: string) => string;

export interface ShowcaseSource {
  id: string;
  title: (say: Say) => string;
  brief: (say: Say) => Brief;
  /** The versions of the work, oldest first: each a request's worth of edits. The home
   * page keeps every one, so it can show the work as it grew. */
  versions: (say: Say) => WorkEdit[];
}

/** A drawing's code, kept as a file of its own in ./drawings so it reads as the code it is. */
export const code = (name: string) => readFileSync(new URL(`./drawings/${name}.js`, import.meta.url), "utf8");

export const sayIn =
  (lang: Lang): Say =>
  (zh, en) =>
    lang === "en" ? en : zh;

/** The style tokens of a library style, as the author's brief takes them in. */
export const styles = {
  crayon: {
    ink: "#1d1d1d",
    muted: "#7a7a7a",
    accent: "#f08a24",
    accent2: "#2e86de",
    paper: "#fffdf7",
    stroke: "3",
    font: '"Kaiti SC","STKaiti","AR PL UKai CN","KaiTi",serif',
  },
  "colored-pencil": {
    ink: "#3b3632",
    muted: "#8a817a",
    accent: "#c8553d",
    accent2: "#4f7c8a",
    paper: "#fbf8f2",
    stroke: "1.6",
    font: '"Songti SC","Noto Serif CJK SC","Source Han Serif SC",serif',
  },
  "ink-figure": {
    ink: "#2b2b2b",
    muted: "#8c8c8c",
    accent: "#d4502a",
    accent2: "#5d6b73",
    paper: "#faf8f4",
    stroke: "1.3",
    font: '"Kaiti SC","STKaiti","AR PL UKai CN","KaiTi",serif',
  },
  textbook: {
    ink: "#1f2a30",
    muted: "#6b7780",
    accent: "#2f7fb5",
    accent2: "#d0632f",
    paper: "#ffffff",
    stroke: "1.4",
    font: '"PingFang SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",system-ui,sans-serif',
  },
  "duotone-icon": {
    ink: "#555555",
    muted: "#8eaebd",
    accent: "#d97757",
    accent2: "#8eaebd",
    paper: "#faf9f5",
    stroke: "1.4",
    font: '"PingFang SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",system-ui,sans-serif',
  },
} satisfies Record<string, Record<string, string>>;

/** A built work as the home page loads it: its versions, oldest first, each naming the
 * materials it holds from the ones they share. */
export interface ShowcaseFile {
  materials: Record<string, MaterialUse>;
  versions: (Omit<Work, "materials"> & { materials: string[] })[];
}
