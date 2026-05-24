import { resolveResultTextClass } from "../../../../shared/webview/lib/statusStyles";

export function StageValueCell({
  label,
  status,
  statusClass,
  duration
}: {
  label: string;
  status?: string;
  statusClass?: string;
  duration?: string;
}) {
  return (
    <div className="min-w-0 rounded border border-mutedBorder bg-background px-2 py-1">
      <p className="text-muted-foreground">{label}</p>
      <p className={`text-sm ${resolveResultTextClass(statusClass)}`}>{status ?? "-"}</p>
      <p className="text-muted-foreground">{duration ?? "-"}</p>
    </div>
  );
}
