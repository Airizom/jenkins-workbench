import { resolveResultTextClass } from "../../../../shared/webview/lib/statusStyles";
import { CompareValueCellShell } from "./shared/CompareValueCellShell";
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
    <CompareValueCellShell label={label}>
      <p className={`text-sm ${resolveResultTextClass(statusClass)}`}>{status ?? "-"}</p>
      <p className="text-muted-foreground">{duration ?? "-"}</p>
    </CompareValueCellShell>
  );
}
