import {
  resolveMetricToneClass,
  type StatusVisualTone
} from "../../../../../shared/TestStatusStyles";
import type {
  BuildCompareAmbiguousTestItem,
  BuildCompareTestDiffItem
} from "../../../../shared/BuildCompareContracts";
import { CompareChangeBadge } from "../shared/CompareChangeBadge";
import { CompareTableEmptyValue } from "../shared/CompareTable";

const META_SEPARATOR = " · ";

function formatTestSubtitle(className?: string, suiteName?: string): string {
  return [className, suiteName].filter(Boolean).join(META_SEPARATOR) || "Unnamed suite";
}

interface TestIdentity {
  name: string;
  className?: string;
  suiteName?: string;
}

function TestNameCell({ item, addedInTarget }: { item: TestIdentity; addedInTarget?: boolean }) {
  return (
    <th scope="row" className="px-3 py-2 text-left font-normal">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {/* Long test names wrap rather than truncate, so nothing hides behind a tooltip. */}
        <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.name}</p>
        {addedInTarget ? <CompareChangeBadge changeType="added" label="New test" /> : null}
      </div>
      <p className="mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">
        {formatTestSubtitle(item.className, item.suiteName)}
      </p>
    </th>
  );
}

function TestStatusCell({
  label,
  status,
  tone,
  note
}: {
  label: string;
  /** Undefined when the test is absent from this build. */
  status?: string;
  tone?: StatusVisualTone;
  /** Muted trailing text: the duration, or the case count of an ambiguous identity. */
  note?: string;
}) {
  return (
    <td className="px-3 py-2" data-label={label}>
      {status ? (
        <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5">
          <span className={tone !== undefined ? resolveMetricToneClass(tone) : undefined}>
            {status}
          </span>
          {note ? <span className="text-muted-foreground tabular-nums">{note}</span> : null}
        </span>
      ) : (
        <CompareTableEmptyValue />
      )}
    </td>
  );
}

export function TestDiffRow({ item }: { item: BuildCompareTestDiffItem }) {
  return (
    <tr className="align-top">
      <TestNameCell item={item} addedInTarget={item.addedInTarget} />
      <TestStatusCell
        label="Baseline"
        status={item.baselineStatusLabel}
        tone={item.baselineStatusTone}
        note={item.baselineDurationLabel}
      />
      <TestStatusCell
        label="Target"
        status={item.targetStatusLabel}
        tone={item.targetStatusTone}
        note={item.targetDurationLabel}
      />
    </tr>
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
    <tr className="align-top">
      <TestNameCell item={item} />
      <TestStatusCell label="Baseline" status={baseline.status} note={baseline.count} />
      <TestStatusCell label="Target" status={target.status} note={target.count} />
    </tr>
  );
}
