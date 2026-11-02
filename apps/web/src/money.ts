/** An amount in US dollars, as precise as small amounts need: a run often costs cents. */
export function money(n: number) {
  if (!n) return "$0";
  const digits = n >= 100 ? 0 : n >= 1 ? 2 : n >= 0.01 ? 3 : 4;
  return "$" + n.toFixed(digits);
}
