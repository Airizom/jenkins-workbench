import {
  resolveMetricToneClass,
  type StatusVisualTone
} from "../../../../../shared/TestStatusStyles";
import type {
  BuildCompareAmbiguousTestItem,
  BuildCompareTestDiffItem
} from "../../../../shared/BuildCompareContracts";
import { CompareDiffRowShell } from "../shared/CompareDiffRowShell";
import { CompareSideGrid } from "../shared/CompareSideGrid";
import { CompareTableEmptyValue } from "../shared/CompareTable";

const META_SEPARATOR = " · ";

function formatTestSubtitle(className?: string, suiteName?: string): string {
  return [className, suiteName].filter(Boolean).join(META_SEPARATOR) || "Unnamed suite";
}

function TestStatusCell({
  label,
  status,
  tone,
  duration
}: {
  label: string;
  /** Undefined when the test is absent from this build. */
  status?: string;
  tone?: StatusVisualTone;
  duration?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className={tone !== undefined ? resolveMetricToneClass(tone) : undefined}>
        {status ?? <CompareTableEmptyValue />}
      </p>
      {duration ? <p className="text-muted-foreground">{duration}</p> : null}
    </div>
  );
}

export function TestDiffRow({ item }: { item: BuildCompareTestDiffItem }) {
  return (
    <CompareDiffRowShell
      title={item.name}
      subtitle={formatTestSubtitle(item.className, item.suiteName)}
      align="center"
      changeType={item.addedInTarget ? "added" : undefined}
      changeLabel={item.addedInTarget ? "New test" : undefined}
    >
      <CompareSideGrid className="text-right">
        <TestStatusCell
          label="Baseline"
          status={item.baselineStatusLabel}
          tone={item.baselineStatusTone}
          duration={item.baselineDurationLabel}
        />
        <TestStatusCell
          label="Target"
          status={item.targetStatusLabel}
          tone={item.targetStatusTone}
          duration={item.targetDurationLabel}
        />
      </CompareSideGrid>
    </CompareDiffRowShell>
  );
}

function formatOccurrences(labels: string[]): { status?: string; count?: string } {
  if (labels.length === 0) {
    return { status: undefined };
  }
  return {
    status: labels.join(", "),
    count: labels.length > 1 ? `${labels.length} cases` : undefined
  };
}

/** Duplicate identities stay unpaired: show every observed status, no tone. */
export function AmbiguousTestRow({ item }: { item: BuildCompareAmbiguousTestItem }) {
  const baseline = formatOccurrences(item.baselineStatusLabels);
  const target = formatOccurrences(item.targetStatusLabels);
  return (
    <CompareDiffRowShell
      title={item.name}
      subtitle={formatTestSubtitle(item.className, item.suiteName)}
      align="center"
    >
      <CompareSideGrid className="text-right">
        <TestStatusCell label="Baseline" status={baseline.status} duration={baseline.count} />
        <TestStatusCell label="Target" status={target.status} duration={target.count} />
      </CompareSideGrid>
    </CompareDiffRowShell>
  );
}
