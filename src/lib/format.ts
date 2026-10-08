// Display helpers (IST). Safe for server and client components.
const TZ = "Asia/Kolkata";

export function fmtDateTime(iso: string | Date | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDate(iso: string | Date | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
export function fmtTime(iso: string | Date | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).toLowerCase();
}
export function fmtDuration(s: number | null): string {
  if (s === null || s === undefined) return "—";
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
export function fmtInr(n: number, digits = 2): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : "—";
}
export const VERDICT_LABEL: Record<string, string> = {
  qualified: "Qualified",
  not_qualified: "Not qualified",
  nurture: "Nurture",
  needs_info: "Needs info",
};
export const TYPE_LABEL: Record<string, string> = {
  lead: "Lead",
  escalation: "Escalation",
  missed_call: "Missed call",
  dropped_call: "Dropped call",
  out_of_scope_channel: "Out of scope",
};
