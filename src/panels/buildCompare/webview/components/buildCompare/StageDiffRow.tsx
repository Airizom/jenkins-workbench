import { ArrowDownIcon, ArrowUpIcon } from "../../../../shared/webview/icons";
import type {
  BuildCompareStageDeltaDirection,
  BuildCompareStageDiffItem
} from "../../../shared/BuildCompareContracts";
import { StageValueCell } from "./StageValueCell";
import { CompareDiffRowShell } from "./shared/CompareDiffRowShell";
import { CompareSideGrid } from "./shared/CompareSideGrid";
import { CompareValueCellShell } from "./shared/CompareValueCellShell";

function resolveDeltaToneClass(direction?: BuildCompareStageDeltaDirection): string {
  switch (direction) {
    case "slower":
      return "text-failure";
    case "faster":
      return "text-success";
    default:
      return "text-muted-foreground";
  }
}

function StageDeltaCell({
  label,
  direction
}: {
  label?: string;
  direction?: BuildCompareStageDeltaDirection;
}) {
  const DirectionIcon =
    direction === "slower" ? ArrowUpIcon : direction === "faster" ? ArrowDownIcon : undefined;
  return (
    <CompareValueCellShell label="Delta">
      <p
        className={`flex items-center gap-1 break-all font-mono text-vscode-editor ${resolveDeltaToneClass(direction)}`}
      >
        {DirectionIcon ? <DirectionIcon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
        <span>{label ?? "-"}</span>
        {direction ? <span className="sr-only">({direction})</span> : null}
      </p>
    </CompareValueCellShell>
  );
}
export function StageDiffRow({ item }: { item: BuildCompareStageDiffItem }) {
  return (
    <CompareDiffRowShell title={item.name} changeType={item.changeType} titleClassName="truncate">
      <CompareSideGrid columns={3}>
        <StageValueCell
          label="Baseline"
          status={item.baselineStatusLabel}
          statusClass={item.baselineStatusClass}
          duration={item.baselineDurationLabel}
        />
        <StageValueCell
          label="Target"
          status={item.targetStatusLabel}
          statusClass={item.targetStatusClass}
          duration={item.targetDurationLabel}
        />
        <StageDeltaCell label={item.deltaLabel} direction={item.deltaDirection} />
      </CompareSideGrid>
    </CompareDiffRowShell>
  );
}
