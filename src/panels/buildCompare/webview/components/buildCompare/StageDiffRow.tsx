import { ArrowDownIcon, ArrowUpIcon } from "../../../../shared/webview/icons";
import {
  resolveResultTextClass,
  resolveStatusAccentClass
} from "../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../shared/webview/lib/utils";
import type {
  BuildCompareStageDeltaDirection,
  BuildCompareStageDiffItem
} from "../../../shared/BuildCompareContracts";
import { CompareChangeBadge } from "./shared/CompareDiffRowShell";
import { CompareTableEmptyValue } from "./shared/CompareTable";

const DELTA_PRESENTATIONS = {
  slower: { icon: ArrowUpIcon, toneClass: "text-failure" },
  faster: { icon: ArrowDownIcon, toneClass: "text-success" }
};

const STATUS_SEVERITY: Record<string, number> = { unstable: 1, failure: 2 };

function statusSeverity(statusClass?: string): number {
  return STATUS_SEVERITY[statusClass ?? ""] ?? 0;
}

function isStatusRegression(item: BuildCompareStageDiffItem): boolean {
  return (
    item.changeType === "matched" &&
    statusSeverity(item.targetStatusClass) > statusSeverity(item.baselineStatusClass)
  );
}

function StageSideCell({
  status,
  statusClass,
  duration
}: {
  status?: string;
  statusClass?: string;
  duration?: string;
}) {
  if (!status) {
    return (
      <td className="px-3 py-2">
        <CompareTableEmptyValue />
      </td>
    );
  }
  return (
    <td className="px-3 py-2">
      <span className="inline-flex max-w-full items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            resolveStatusAccentClass(statusClass ?? "")
          )}
        />
        <span className={resolveResultTextClass(statusClass)}>{status}</span>
        {duration ? (
          <span className="truncate text-muted-foreground tabular-nums">{duration}</span>
        ) : null}
      </span>
    </td>
  );
}

function StageDeltaCell({
  label,
  direction
}: {
  label?: string;
  direction?: BuildCompareStageDeltaDirection;
}) {
  const presentation = direction ? DELTA_PRESENTATIONS[direction] : undefined;
  const DirectionIcon = presentation?.icon;
  return (
    <td className="px-3 py-2 text-right">
      {label ? (
        <span
          className={cn(
            "inline-flex items-center justify-end gap-1 font-mono tabular-nums",
            presentation?.toneClass ?? "text-muted-foreground"
          )}
        >
          {DirectionIcon ? <DirectionIcon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          {label}
          {direction ? <span className="sr-only">({direction})</span> : null}
        </span>
      ) : (
        <CompareTableEmptyValue />
      )}
    </td>
  );
}

export function StageDiffRow({ item }: { item: BuildCompareStageDiffItem }) {
  const regressed = isStatusRegression(item);
  return (
    <tr className={cn(regressed && "bg-failure-surface")}>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-medium",
              item.changeType === "removed" && "text-muted-foreground line-through"
            )}
          >
            {item.name}
          </span>
          <CompareChangeBadge changeType={item.changeType} />
          {regressed ? <span className="sr-only">(status regressed)</span> : null}
        </div>
      </th>
      <StageSideCell
        status={item.baselineStatusLabel}
        statusClass={item.baselineStatusClass}
        duration={item.baselineDurationLabel}
      />
      <StageSideCell
        status={item.targetStatusLabel}
        statusClass={item.targetStatusClass}
        duration={item.targetDurationLabel}
      />
      <StageDeltaCell label={item.deltaLabel} direction={item.deltaDirection} />
    </tr>
  );
}
