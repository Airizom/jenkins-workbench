import { BuildResultStatusIcon } from "../../../../shared/webview/components/BuildResultStatusIcon";
import { BuildDetailsMetaFields } from "./BuildDetailsMetaFields";
import { StatusPill } from "./StatusPill";

export function BuildSummaryCard({
  displayName,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  culpritsLabel
}: {
  displayName: string;
  resultLabel: string;
  resultClass?: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-border bg-muted-soft px-3 py-2.5">
      <div className="flex items-center gap-2">
        <BuildResultStatusIcon status={resultClass} />
        <span className="text-xs font-semibold">{displayName}</span>
        <StatusPill label={resultLabel} status={resultClass} className="text-[10px]" />
      </div>
      <BuildDetailsMetaFields
        durationLabel={durationLabel}
        timestampLabel={timestampLabel}
        culpritsLabel={culpritsLabel}
        showSeparators={false}
        className="flex items-center gap-3 text-xs text-muted-foreground"
      />
    </div>
  );
}
