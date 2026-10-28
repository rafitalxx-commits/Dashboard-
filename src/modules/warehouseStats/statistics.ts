export type Activity = {
  id: string; workerId: string; workerName: string; workerCode: string; orderRef: string;
  resolvedOrderRef?: string; carrier?: string; tracking?: string; result?: string; createdAt: string;
};
export type Worker = { id: string; code: string; name: string; active: boolean };
export type Range = "today" | "week" | "month";
export type Bucket = { key: string; label: string; total: number; workers: Record<string, number> };
export const TIME_ZONE = "Europe/Madrid";
const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

export function localDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour };
}
export function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function periodFor(range: Range, month: string, now = new Date()) {
  const today = localDate(now)!.day;
  if (range === "today") return { from: today, to: today };
  if (range === "week") return { from: shiftDay(today, -6), to: today };
  const safeMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
  const end = new Date(`${safeMonth}-01T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from: `${safeMonth}-01`, to: [end.toISOString().slice(0, 10), today].sort()[0] };
}
export function orderReference(item: Activity) { return (item.resolvedOrderRef || item.orderRef || "").trim().toUpperCase(); }
// Attribute an order to its first real label, before applying period/worker filters.
// Reissued labels remain available in the label ledger but cannot duplicate an order.
export function uniqueOrders(activities: Activity[], now = new Date()) {
  const seen = new Set<string>();
  return activities.filter(item => item.result === "label-created" && Number.isFinite(Date.parse(item.createdAt)) && Date.parse(item.createdAt) <= now.getTime())
    .slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
    .filter(item => { const key = orderReference(item); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}
export function withinPeriod(items: Activity[], period: { from: string; to: string }, worker: string) {
  return items.filter(item => { const date = localDate(item.createdAt); return date && date.day >= period.from && date.day <= period.to && (worker === "all" || item.workerId === worker); });
}
export function bucketOrders(items: Activity[], kind: "hour" | "day", period: { from: string; to: string }): Bucket[] {
  const buckets = new Map<string, Bucket>();
  if (kind === "hour") for (let hour = 0; hour < 24; hour++) { const key = String(hour).padStart(2, "0"); buckets.set(key, { key, label: `${key}:00`, total: 0, workers: {} }); }
  else for (let key = period.from; key <= period.to; key = shiftDay(key, 1)) buckets.set(key, { key, label: key.slice(8), total: 0, workers: {} });
  for (const item of items) {
    const date = localDate(item.createdAt);
    const bucket = date && buckets.get(kind === "hour" ? date.hour : date.day);
    if (bucket) { bucket.total++; bucket.workers[item.workerId] = (bucket.workers[item.workerId] || 0) + 1; }
  }
  return [...buckets.values()];
}
const palette = ["#4f8cff", "#21b987", "#a879e8", "#e9a23b", "#e66e86", "#20a7b4", "#6979cb", "#b58a57"];
export function workerRoster(workers: Worker[], activities: Activity[]) {
  const roster = new Map(workers.map(worker => [worker.id, worker]));
  for (const item of activities) if (!roster.has(item.workerId)) roster.set(item.workerId, { id: item.workerId, code: item.workerCode, name: item.workerName, active: false });
  return [...roster.values()].sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id)).map((worker, index) => ({ ...worker, color: palette[index] || `hsl(${(index * 137.508) % 360} 58% 43%)` }));
}

export function weekDayRows(items: Activity[], period: { from: string; to: string }) {
  return bucketOrders(items, "day", period).map(day => {
    const weekday = new Date(`${day.key}T12:00:00Z`).getUTCDay();
    return { ...day, weekend: weekday === 0 || weekday === 6, hours: bucketOrders(items.filter(item => localDate(item.createdAt)?.day === day.key), "hour", period) };
  }).filter(day => !day.weekend || day.total > 0);
}
// Crop only empty edge hours; retain every internal zero, and never drop an event.
export function activeHourKeys(rows: ReturnType<typeof weekDayRows>) {
  const active = rows.flatMap(day => day.hours.filter(hour => hour.total > 0).map(hour => Number(hour.key)));
  const from = active.length ? Math.min(...active) : 0, to = active.length ? Math.max(...active) : 23;
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, "0"));
}
