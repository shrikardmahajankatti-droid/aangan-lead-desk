import { TYPE_LABEL, VERDICT_LABEL } from "@/lib/format";

const base = "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

export function VerdictBadge({ verdict, overridden }: { verdict: string | null; overridden?: boolean }) {
  if (!verdict) return <span className="text-stone-400">—</span>;
  const tone =
    verdict === "qualified"
      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : verdict === "nurture"
        ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : verdict === "needs_info"
          ? "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
          : "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
  return (
    <span className={`${base} ${tone}`} title={overridden ? "Overridden by Nikhil" : undefined}>
      {VERDICT_LABEL[verdict] ?? verdict}
      {overridden ? " ✎" : ""}
    </span>
  );
}

export function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-stone-400">—</span>;
  const tone =
    type === "escalation"
      ? "bg-red-600 text-white"
      : type === "missed_call" || type === "dropped_call"
        ? "bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100"
        : "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
  return <span className={`${base} ${tone}`}>{TYPE_LABEL[type] ?? type}</span>;
}

export function ScoreBadge({ score, label }: { score: number | null; label: string | null }) {
  if (score === null || score === undefined) return <span className="text-stone-400">—</span>;
  const tone =
    label === "Hot"
      ? "bg-accent text-white"
      : label === "Warm"
        ? "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200"
        : "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
  return (
    <span className={`${base} ${tone}`}>
      {label === "Hot" ? "🔥 " : ""}
      {score}/10 {label}
    </span>
  );
}

/** Delivery status for email / HubSpot / booking. */
export function StatusDot({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    done: ["✓", "text-emerald-700 dark:text-emerald-400"],
    dry_run: ["dry run", "text-stone-500"],
    pending: ["pending", "text-amber-700 dark:text-amber-400"],
    failed: ["failed", "text-red-600"],
    not_applicable: ["—", "text-stone-400"],
  };
  const [text, tone] = map[status] ?? [status, ""];
  return <span className={`text-xs ${tone}`}>{text}</span>;
}

export function UrgentFlag() {
  return <span className={`${base} bg-red-600 text-white`}>URGENT</span>;
}
