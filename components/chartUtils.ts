/**
 * Shared chart helpers — period filtering, MoM / YoY deltas, formatters.
 * Pure functions, no React, no DOM. Both GrowthChart and AcquisitionChart
 * lean on these so the period selector stays in sync.
 */

export type Period = "30d" | "90d" | "6m" | "1y" | "all";

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "6m", label: "6 months" },
  { value: "1y", label: "1 year" },
  { value: "all", label: "All time" },
];

const PERIOD_DAYS: Record<Period, number | null> = {
  "30d": 30,
  "90d": 90,
  "6m": 182,
  "1y": 365,
  all: null,
};

export interface TimePoint {
  ran_at: string;
  [key: string]: any;
}

/** Filter snapshots whose ran_at falls inside the selected lookback window. */
export function filterByPeriod<T extends TimePoint>(series: T[], period: Period): T[] {
  const days = PERIOD_DAYS[period];
  if (days == null) return series;
  const cutoff = Date.now() - days * 86_400_000;
  return series.filter((s) => new Date(s.ran_at).getTime() >= cutoff);
}

/** v1.1.14: explicit date-range filter. `from` and `to` are ISO yyyy-MM-dd
 *  strings (the format native <input type="date"> emits). Either bound can be
 *  null to mean "open on that side." `to` is treated as end-of-day so a date
 *  the user picked is inclusive. */
export interface DateRange {
  from: string | null;
  to: string | null;
}

export function filterByDateRange<T extends TimePoint>(series: T[], range: DateRange): T[] {
  if (!range.from && !range.to) return series;
  const fromMs = range.from ? new Date(range.from + "T00:00:00").getTime() : -Infinity;
  const toMs = range.to ? new Date(range.to + "T23:59:59.999").getTime() : Infinity;
  return series.filter((s) => {
    const t = new Date(s.ran_at).getTime();
    return t >= fromMs && t <= toMs;
  });
}

/** Convert a Period preset to a concrete DateRange anchored to today. Used by
 *  the quick-preset chips in DateRangeSelector so picking "30 days" populates
 *  the from/to inputs. */
export function presetToRange(period: Period): DateRange {
  const days = PERIOD_DAYS[period];
  const today = isoDate(new Date());
  if (days == null) return { from: null, to: null };
  return { from: isoDate(new Date(Date.now() - days * 86_400_000)), to: today };
}

/** Format a Date as yyyy-MM-dd in local time (matching what <input type="date"> emits). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Default range for fresh-mount: last 90 days through today. */
export const DEFAULT_RANGE: DateRange = presetToRange("90d");

/**
 * Compute % change between the latest snapshot and the snapshot taken
 * `daysAgo` days before it. Picks the closest prior snapshot at or before
 * the target time. Returns null if we don't have enough history.
 */
export function periodGrowth<T extends TimePoint>(
  series: T[],
  daysAgo: number,
  key: keyof T,
): number | null {
  if (!series || series.length < 2) return null;
  const latest = series[series.length - 1];
  const latestT = new Date(latest.ran_at).getTime();
  const target = latestT - daysAgo * 86_400_000;
  if (target < new Date(series[0].ran_at).getTime()) return null;
  let prior: T | null = null;
  for (const s of series) {
    if (new Date(s.ran_at).getTime() <= target) prior = s;
    else break;
  }
  if (!prior) return null;
  const cur = Number(latest[key]);
  const prv = Number(prior[key]);
  if (!Number.isFinite(prv) || prv === 0) return null;
  return (cur - prv) / prv;
}

export function fmtPctSigned(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(1)}%`;
}

export function fmtDate(d: string): string {
  return new Date(d).toLocaleString(undefined, { month: "short", day: "numeric" });
}
