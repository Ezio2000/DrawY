import { pageLocale } from "@drawy/ui";
import { dictionaries } from "./i18n.tsx";

const pad = (n: number) => String(n).padStart(2, "0");
const words = () => dictionaries[pageLocale()].time;
/** When something happened, as people say it: 刚刚, 5 分钟前, 今天 14:03, 昨天 09:12,
 * 10月28日, 2025年3月2日 — or the same in English. */
export function ago(at: number, now = Date.now()) {
  const t = words();
  const d = new Date(at),
    today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const s = (now - at) / 1000;
  if (s < 60) return t.now;
  if (s < 3600) return t.minutes(Math.floor(s / 60));
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (at >= today.getTime()) return t.today(clock);
  if (at >= today.getTime() - 86400_000) return t.yesterday(clock);
  return d.getFullYear() === today.getFullYear()
    ? t.date(d.getMonth() + 1, d.getDate())
    : t.fullDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
/** A length of time: 850ms, 12 秒, 1 分 32 秒. */
export function span(ms = 0) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const t = words();
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? t.seconds(seconds)
    : t.minutesSeconds(Math.floor(seconds / 60), seconds % 60);
}
