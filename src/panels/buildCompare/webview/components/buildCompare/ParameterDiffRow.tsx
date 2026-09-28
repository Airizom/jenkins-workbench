import { cn } from "../../../../shared/webview/lib/utils";
import type { BuildCompareParameterDiffItem } from "../../../shared/BuildCompareContracts";
import { CompareChangeBadge } from "./shared/CompareDiffRowShell";
import { CompareTableEmptyValue } from "./shared/CompareTable";

function ParameterValue({ value, muted }: { value?: string; muted?: boolean }) {
  if (value === undefined) {
    return <CompareTableEmptyValue />;
  }
  return (
    <span className={cn("font-mono [overflow-wrap:anywhere]", muted && "text-muted-foreground")}>
      {value === "" ? '""' : value}
    </span>
  );
}

export function ParameterDiffRow({ item }: { item: BuildCompareParameterDiffItem }) {
  return (
    <tr className="align-top">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* break-words keeps names like NODE_VERSION whole unless they cannot fit at all. */}
          <span className="break-words font-mono font-medium">{item.name}</span>
          <CompareChangeBadge changeType={item.changeType} />
        </div>
      </th>
      <td className="px-3 py-2" data-label="Baseline">
        <ParameterValue value={item.baselineValue} muted={item.changeType === "changed"} />
      </td>
      <td className="px-3 py-2" data-label="Target">
        <ParameterValue value={item.targetValue} />
      </td>
    </tr>
  );
}
