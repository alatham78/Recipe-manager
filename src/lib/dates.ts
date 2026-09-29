/** Local-date helpers working with YYYY-MM-DD strings. */

export const WEEK_STARTS_ON = 0; // Sunday

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function fromISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
export const todayISO = () => toISO(new Date());

export function addDays(s: string, n: number): string {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function startOfWeek(s: string): string {
  const d = fromISO(s);
  const diff = (d.getDay() - WEEK_STARTS_ON + 7) % 7;
  d.setDate(d.getDate() - diff);
  return toISO(d);
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function fmtDay(s: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return fromISO(s).toLocaleDateString(undefined, opts);
}

export function fmtRange(start: string, end: string) {
  const a = fromISO(start);
  const b = fromISO(end);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const right = b.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${left} – ${right}`;
}

export function relativeDay(s: string): string {
  const t = todayISO();
  if (s === t) return "Today";
  if (s === addDays(t, 1)) return "Tomorrow";
  if (s === addDays(t, -1)) return "Yesterday";
  return fmtDay(s);
}

export function sinceText(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.round((fromISO(todayISO()).getTime() - fromISO(iso.slice(0, 10)).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}
