const pad = (n: number) => String(n).padStart(2, "0");
/** When something happened, as people say it: 刚刚, 5 分钟前, 今天 14:03, 昨天 09:12,
 * 10月28日, 2025年3月2日. */
export function ago(at: number, now = Date.now()) {
  const d = new Date(at),
    today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const s = (now - at) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (at >= today.getTime()) return `今天 ${clock}`;
  if (at >= today.getTime() - 86400_000) return `昨天 ${clock}`;
  return d.getFullYear() === today.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
/** A length of time: 850ms, 12 秒, 1 分 32 秒. */
export function span(ms = 0) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
