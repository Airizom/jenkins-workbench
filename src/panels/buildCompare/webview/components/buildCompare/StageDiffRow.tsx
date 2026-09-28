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
import { isStageStatusRegression } from "./stageDiffModel";

const DELTA_PRESENTATIONS = {
  slower: { icon: ArrowUpIcon, significantToneClass: "text-failure" },
  faster: { icon: ArrowDownIcon, significantToneClass: "text-success" }
};

function StageSideCell({
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
  if (!status) {
    return (
      <td className="px-3 py-2" data-label={label}>
        <CompareTableEmptyValue />
      </td>
    );
  }
  return (
    <td className="px-3 py-2" data-label={label}>
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
          <span className="truncate text-muted-foreground tabular-nums" title={duration}>
            {duration}
          </span>
        ) : null}
      </span>
    </td>
  );
}

/**
 * Only deltas past the backend threshold (the same one the summary counts)
 * get a regression/improvement color; smaller swings stay muted.
 */
function StageDeltaCell({
  label,
  direction,
  significant
}: {
  label?: string;
  direction?: BuildCompareStageDeltaDirection;
  significant?: boolean;
}) {
  const presentation = direction ? DELTA_PRESENTATIONS[direction] : undefined;
  const DirectionIcon = presentation?.icon;
  return (
    <td className="px-3 py-2 text-right" data-label="Change">
      {label ? (
        <span
          className={cn(
            "inline-flex items-center justify-end gap-1 font-mono tabular-nums",
            significant && presentation
              ? presentation.significantToneClass
              : "text-muted-foreground"
          )}
        >
          {DirectionIcon ? <DirectionIcon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          {label}
          {direction ? (
            <span className="sr-only">
              {`(${direction}${significant ? "" : ", within normal variation"})`}
            </span>
          ) : null}
        </span>
      ) : (
        <CompareTableEmptyValue label="No change data" />
      )}
    </td>
  );
}

export function StageDiffRow({ item }: { item: BuildCompareStageDiffItem }) {
  const regressed = isStageStatusRegression(item);
  return (
    <tr className={cn(regressed && "bg-failure-surface")}>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-medium",
              item.changeType === "removed" && "text-muted-foreground line-through"
            )}
            title={item.name}
          >
            {item.name}
          </span>
          <CompareChangeBadge changeType={item.changeType} />
          {regressed ? <span className="sr-only">(status regressed)</span> : null}
        </div>
      </th>
      <StageSideCell
        label="Baseline"
        status={item.baselineStatusLabel}
        statusClass={item.baselineStatusClass}
        duration={item.baselineDurationLabel}
      />
      <StageSideCell
        label="Target"
        status={item.targetStatusLabel}
        statusClass={item.targetStatusClass}
        duration={item.targetDurationLabel}
      />
      <StageDeltaCell
        label={item.deltaLabel}
        direction={item.deltaDirection}
        significant={item.deltaSignificant}
      />
    </tr>
  );
}
