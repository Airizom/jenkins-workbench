import { ArrowDownIcon, ArrowUpIcon } from "../../../../shared/webview/icons";
import { resolveBuildResultStyle } from "../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../shared/webview/lib/utils";
import type {
  BuildCompareStageDeltaDirection,
  BuildCompareStageDiffItem
} from "../../../shared/BuildCompareContracts";
import { CompareChangeBadge } from "./shared/CompareChangeBadge";
import { CompareTableEmptyValue } from "./shared/CompareTable";
import { isNewUnsuccessfulStage, isStageStatusRegression } from "./stageDiffModel";

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
  const statusStyle = resolveBuildResultStyle(statusClass);
  return (
    <td className="px-3 py-2" data-label={label}>
      <span className="inline-flex max-w-full items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusStyle.accent)}
        />
        <span className={statusStyle.text}>{status}</span>
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

/** Screen-reader text for rows tinted as getting worse. */
function resolveStageAlert(item: BuildCompareStageDiffItem): string | undefined {
  if (isStageStatusRegression(item)) {
    return "(status regressed)";
  }
  if (isNewUnsuccessfulStage(item)) {
    return "(new stage did not succeed)";
  }
  return undefined;
}

export function StageDiffRow({ item }: { item: BuildCompareStageDiffItem }) {
  const alert = resolveStageAlert(item);
  return (
    <tr className={cn("align-top", alert && "bg-failure-surface")}>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {/* Stage paths wrap instead of truncating; parallel branches get long. */}
          <span
            className={cn(
              "min-w-0 font-medium [overflow-wrap:anywhere]",
              item.changeType === "removed" && "text-muted-foreground line-through"
            )}
          >
            {item.name}
          </span>
          <CompareChangeBadge changeType={item.changeType} />
          {alert ? <span className="sr-only">{alert}</span> : null}
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
