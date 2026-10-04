export type Period = "today" | "yesterday" | "week" | "last_week" | "month" | "last_month" | "all";

const INDIA_OFFSET_MS = 330 * 60_000;

function indiaParts(value: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(value);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdayName = read("weekday");
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: Number(read("year")), month: Number(read("month")), day: Number(read("day")), weekday: weekdayMap[weekdayName] ?? 0 };
}

function fromIndiaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - INDIA_OFFSET_MS);
}

export function getPeriodRange(period: Period, now = new Date()): { from?: string; to?: string } {
  if (period === "all") return {};
  const parts = indiaParts(now);
  const pseudo = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (period === "yesterday") pseudo.setUTCDate(pseudo.getUTCDate() - 1);
  if (period === "week" || period === "last_week") {
    const dayOffset = (pseudo.getUTCDay() + 6) % 7;
    pseudo.setUTCDate(pseudo.getUTCDate() - dayOffset);
    if (period === "last_week") pseudo.setUTCDate(pseudo.getUTCDate() - 7);
    const from = fromIndiaMidnight(pseudo.getUTCFullYear(), pseudo.getUTCMonth() + 1, pseudo.getUTCDate());
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (period === "last_month") {
    const to = fromIndiaMidnight(parts.year, parts.month, 1);
    const previousMonth = new Date(Date.UTC(parts.year, parts.month - 2, 1));
    const from = fromIndiaMidnight(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (period === "month") {
    const from = fromIndiaMidnight(parts.year, parts.month, 1);
    const to = parts.month === 12 ? fromIndiaMidnight(parts.year + 1, 1, 1) : fromIndiaMidnight(parts.year, parts.month + 1, 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const target = period === "yesterday" ? new Date(pseudo) : new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const from = fromIndiaMidnight(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate());
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function indiaDateKey(timestamp: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function indiaDayLabel(timestamp: string | Date, weekday: "long" | "short" | "narrow" = "short"): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday }).format(new Date(timestamp));
}
