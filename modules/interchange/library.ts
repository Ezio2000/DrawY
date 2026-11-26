/* The library drawings imports and exports know by name, besides those the library binds
 * to words, pictures and links: the block a figure is built from and the speech bubble,
 * as the editor's shape tools draw them, and the sequence diagram Mermaid's sequence
 * diagrams come in as. */

export const NODE = "node";
export const CALLOUT = "callout";
export const SEQUENCE = "sequence";

/** The colour a node or bubble is drawn in: its own, or its tone's in the work's style. */
export function toneColor(style: Record<string, string>, tone: unknown, color: unknown) {
  if (typeof color === "string" && color) return color;
  const muted = style.muted || "#888888";
  const tones: Record<string, string> = {
    plain: muted,
    muted,
    accent: style.accent || "#d97757",
    accent2: style.accent2 || style.accent || "#4f7c8a",
    ink: style.ink || "#222222",
  };
  return tones[typeof tone === "string" ? tone : "plain"] ?? muted;
}
