/** Sent-order comparison, grouped in the operational Europe/Madrid timezone. */
export type ComparisonPeriod = "today" | "week" | "month";
export type ComparisonChannel = "fbm" | "website";
export type SentSale = {
  id: number;
  dateDone: string;
  amountUntaxed: number;
  team: string;
  fulfillmentBy?: string;
};
export type ComparisonBucket = {
  key: string;
  label: string;
  fbmOrders: number;
  websiteOrders: number;
  fbmSales: number;
  websiteSales: number;
};

const madrid = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});
const weekdays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function madridParts(date: Date) {
  const parts = Object.fromEntries(madrid.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) };
}

function dayKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localDayStart(year: number, month: number, day: number) {
  // Madrid is UTC+1/+2; search the three candidate hours around local midnight.
  const wanted = dayKey(year, month, day);
  const midnight = Date.UTC(year, month - 1, day);
  for (let offset = 3; offset >= -1; offset--) {
    const candidate = new Date(midnight - offset * 3_600_000);
    const local = madridParts(candidate);
    if (dayKey(local.year, local.month, local.day) === wanted && local.hour === 0) return candidate;
  }
  throw new Error(`No se pudo calcular medianoche de Madrid: ${wanted}`);
}

export function comparisonBounds(now = new Date()) {
  const local = madridParts(now);
  const today = localDayStart(local.year, local.month, local.day);
  const month = localDayStart(local.year, local.month, 1);
  const localWeekday = (new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(local.year, local.month - 1, local.day - localWeekday));
  const week = localDayStart(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
  return { start: new Date(Math.min(month.getTime(), week.getTime())), today, week, month, end: now };
}

export function comparisonChannel(sale: Pick<SentSale, "team" | "fulfillmentBy">): ComparisonChannel | null {
  const team = sale.team.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  const fulfillment = (sale.fulfillmentBy || "").trim().toUpperCase();
  if (fulfillment === "FBA") return null;
  if (fulfillment === "FBM" || (team.includes("amazon") && team.includes("fbm"))) return "fbm";
  if (team === "website" || team === "web") return "website";
  return null;
}

export function parseOdooUtc(value: string) {
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Fecha de envío no válida: ${value}`);
  return parsed;
}

export function buildHomeComparison(sales: SentSale[], now = new Date()) {
  const bounds = comparisonBounds(now);
  const current = madridParts(now);
  const periods: Record<ComparisonPeriod, ComparisonBucket[]> = { today: [], week: [], month: [] };
  for (let hour = 0; hour <= current.hour; hour++) periods.today.push({ key: `${dayKey(current.year, current.month, current.day)}T${String(hour).padStart(2, "0")}`, label: `${String(hour).padStart(2, "0")}h`, fbmOrders: 0, websiteOrders: 0, fbmSales: 0, websiteSales: 0 });
  const monday = madridParts(bounds.week);
  for (let index = 0; index < 7; index++) {
    const date = new Date(Date.UTC(monday.year, monday.month - 1, monday.day + index));
    periods.week.push({ key: dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()), label: weekdays[index], fbmOrders: 0, websiteOrders: 0, fbmSales: 0, websiteSales: 0 });
  }
  for (let day = 1; day <= current.day; day++) periods.month.push({ key: dayKey(current.year, current.month, day), label: String(day), fbmOrders: 0, websiteOrders: 0, fbmSales: 0, websiteSales: 0 });
  const lookups = Object.fromEntries((Object.keys(periods) as ComparisonPeriod[]).map((period) => [period, new Map(periods[period].map((bucket) => [bucket.key, bucket]))])) as Record<ComparisonPeriod, Map<string, ComparisonBucket>>;
  for (const sale of sales) {
    const channel = comparisonChannel(sale);
    if (!channel) continue;
    const done = parseOdooUtc(sale.dateDone);
    if (done < bounds.start || done > now) continue;
    const local = madridParts(done);
    const key = dayKey(local.year, local.month, local.day);
    const keys: Array<[ComparisonPeriod, string]> = [["today", `${key}T${String(local.hour).padStart(2, "0")}`], ["week", key], ["month", key]];
    for (const [period, bucketKey] of keys) {
      const bucket = lookups[period].get(bucketKey);
      if (!bucket) continue;
      bucket[`${channel}Orders`] += 1;
      bucket[`${channel}Sales`] = Math.round((bucket[`${channel}Sales`] + sale.amountUntaxed) * 100) / 100;
    }
  }
  return { periods, updatedAt: now.toISOString(), timezone: "Europe/Madrid" as const, source: "stock.picking.date_done + sale.order.amount_untaxed" as const };
}


export type ComparisonGranularity = "hour" | "day" | "month";
export type HomeComparisonRange = {
  buckets: ComparisonBucket[];
  granularity: ComparisonGranularity;
  range: { from: string; to: string };
  period?: "48h";
  updatedAt: string;
  timezone: "Europe/Madrid";
  source: string;
};

function validateDayKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Fecha no válida");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) throw new Error("Fecha no válida");
  return { year, month, day, date };
}

function emptyBucket(key: string, label: string): ComparisonBucket {
  return { key, label, fbmOrders: 0, websiteOrders: 0, fbmSales: 0, websiteSales: 0 };
}

/** Builds one arbitrary inclusive calendar range, with Madrid-local bucket boundaries. */
export function buildHomeComparisonRange(sales: SentSale[], from: string, to: string, now = new Date()): HomeComparisonRange {
  const first = validateDayKey(from);
  const last = validateDayKey(to);
  const spanDays = Math.round((Date.UTC(last.year, last.month - 1, last.day) - Date.UTC(first.year, first.month - 1, first.day)) / 86_400_000) + 1;
  if (spanDays < 1) throw new Error("La fecha Hasta debe ser igual o posterior a Desde");
  if (spanDays > 3660) throw new Error("El rango máximo es de 10 años");
  const start = localDayStart(first.year, first.month, first.day);
  const afterLast = new Date(Date.UTC(last.year, last.month - 1, last.day + 1));
  const endExclusive = localDayStart(afterLast.getUTCFullYear(), afterLast.getUTCMonth() + 1, afterLast.getUTCDate());
  const granularity: ComparisonGranularity = spanDays === 1 ? "hour" : spanDays <= 62 ? "day" : "month";
  const buckets: ComparisonBucket[] = [];
  if (granularity === "hour") {
    const current = madridParts(now);
    const hourCount = from === dayKey(current.year, current.month, current.day) ? current.hour + 1 : 24;
    for (let hour = 0; hour < hourCount; hour++) buckets.push(emptyBucket(`${from}T${String(hour).padStart(2, "0")}`, `${String(hour).padStart(2, "0")}h`));
  } else if (granularity === "day") {
    for (let index = 0; index < spanDays; index++) {
      const date = new Date(Date.UTC(first.year, first.month - 1, first.day + index));
      const key = dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
      buckets.push(emptyBucket(key, new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(date)));
    }
  } else {
    const cursor = new Date(Date.UTC(first.year, first.month - 1, 1));
    const finalMonth = Date.UTC(last.year, last.month - 1, 1);
    while (cursor.getTime() <= finalMonth) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
      buckets.push(emptyBucket(key, new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "short", year: "2-digit" }).format(cursor)));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const lookup = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const sale of sales) {
    const channel = comparisonChannel(sale);
    if (!channel) continue;
    const done = parseOdooUtc(sale.dateDone);
    if (done < start || done >= endExclusive || done > now) continue;
    const local = madridParts(done);
    const date = dayKey(local.year, local.month, local.day);
    const key = granularity === "hour" ? `${date}T${String(local.hour).padStart(2, "0")}` : granularity === "month" ? date.slice(0, 7) : date;
    const bucket = lookup.get(key);
    if (!bucket) continue;
    bucket[`${channel}Orders`] += 1;
    bucket[`${channel}Sales`] = Math.round((bucket[`${channel}Sales`] + sale.amountUntaxed) * 100) / 100;
  }
  return { buckets, granularity, range: { from, to }, updatedAt: now.toISOString(), timezone: "Europe/Madrid", source: "stock.picking.date_done + sale.order.amount_untaxed" };
}


/** Builds exactly 48 rolling one-hour buckets; boundaries are real elapsed hours, not local calendar days. */
export function buildHomeComparisonRolling48h(sales: SentSale[], now = new Date()): HomeComparisonRange {
  const hourMs = 3_600_000;
  const startMs = now.getTime() - 48 * hourMs;
  const buckets: ComparisonBucket[] = Array.from({ length: 48 }, (_, index) => {
    const start = new Date(startMs + index * hourMs);
    const local = madridParts(start);
    const label = `${String(local.day).padStart(2, "0")}/${String(local.month).padStart(2, "0")} ${String(local.hour).padStart(2, "0")}h`;
    return { ...emptyBucket(start.toISOString(), label) };
  });
  for (const sale of sales) {
    const channel = comparisonChannel(sale);
    if (!channel) continue;
    const done = parseOdooUtc(sale.dateDone);
    const index = Math.floor((done.getTime() - startMs) / hourMs);
    if (index < 0 || index >= buckets.length || done >= now) continue;
    const bucket = buckets[index];
    bucket[`${channel}Orders`] += 1;
    bucket[`${channel}Sales`] = Math.round((bucket[`${channel}Sales`] + sale.amountUntaxed) * 100) / 100;
  }
  const dateFor = (date: Date) => { const local = madridParts(date); return dayKey(local.year, local.month, local.day); };
  return { buckets, granularity: "hour", period: "48h", range: { from: dateFor(new Date(startMs)), to: dateFor(now) }, updatedAt: now.toISOString(), timezone: "Europe/Madrid", source: "stock.picking.date_done + sale.order.amount_untaxed" };
}
