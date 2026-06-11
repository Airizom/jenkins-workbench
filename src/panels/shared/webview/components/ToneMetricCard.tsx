import {
  type StatusVisualTone,
  resolveMetricCardClass,
  resolveMetricDotClass,
  resolveMetricToneClass
} from "../../TestStatusStyles";
import { cn } from "../lib/utils";
export function ToneMetricCard({
  label,
  value,
  tone,
  showDot = false
}: {
  label: string;
  value?: number | string;
  tone: StatusVisualTone;
  showDot?: boolean;
}) {
  const displayValue =
    value === undefined
      ? "Unavailable"
      : typeof value === "number"
        ? value.toLocaleString()
        : value;

  return (
    <div className={cn("rounded border px-3 py-2", resolveMetricCardClass(tone))}>
      <div className="flex items-center gap-1.5">
        {showDot && tone !== "neutral" ? (
          <span
            className={cn("inline-block h-1.5 w-1.5 rounded-full", resolveMetricDotClass(tone))}
          />
        ) : null}
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", resolveMetricToneClass(tone))}>
        {displayValue}
      </div>
    </div>
  );
}
