import { type StatusVisualTone, resolveStatusBorderClass } from "../../TestStatusStyles";
import { cn } from "../lib/utils";

export function TestDetailBlock({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: StatusVisualTone;
}) {
  return (
    <div
      className={cn(
        "rounded border border-border bg-background",
        resolveStatusBorderClass(tone ?? "neutral")
      )}
    >
      <div className="border-b border-border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="m-0 max-h-52 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word">
        {value}
      </pre>
    </div>
  );
}
