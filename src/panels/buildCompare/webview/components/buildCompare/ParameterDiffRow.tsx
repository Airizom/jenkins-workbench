import { createUniqueListKeys } from "../../../../shared/webview/lib/uniqueListKeys";
import { cn } from "../../../../shared/webview/lib/utils";
import type { BuildCompareParameterDiffItem } from "../../../shared/BuildCompareContracts";
import { diffParameterValues, type ParameterValueSegment } from "./parameterValueDiff";
import { CompareChangeBadge } from "./shared/CompareChangeBadge";
import { CompareTableEmptyValue } from "./shared/CompareTable";

function ParameterValue({
  value,
  muted,
  segments,
  side
}: {
  value?: string;
  muted?: boolean;
  /** Word-level diff of a changed value; changed words get a diff highlight. */
  segments?: ParameterValueSegment[];
  side: "baseline" | "target";
}) {
  if (value === undefined) {
    return <CompareTableEmptyValue />;
  }
  const Mark = side === "baseline" ? "del" : "ins";
  const keys = segments ? createUniqueListKeys(segments, (segment) => segment.text) : [];
  return (
    <span className={cn("font-mono [overflow-wrap:anywhere]", muted && "text-muted-foreground")}>
      {segments
        ? segments.map((segment, index) =>
            segment.changed ? (
              <Mark
                key={keys[index]}
                data-change={side === "baseline" ? "removed" : "added"}
                className="bc-diff-token"
              >
                {segment.text}
              </Mark>
            ) : (
              <span key={keys[index]}>{segment.text}</span>
            )
          )
        : value === ""
          ? '""'
          : value}
    </span>
  );
}

export function ParameterDiffRow({ item }: { item: BuildCompareParameterDiffItem }) {
  const diff =
    item.changeType === "changed" &&
    item.baselineValue !== undefined &&
    item.targetValue !== undefined
      ? diffParameterValues(item.baselineValue, item.targetValue)
      : undefined;
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
        <ParameterValue
          side="baseline"
          value={item.baselineValue}
          muted={item.changeType === "changed"}
          segments={diff?.baseline}
        />
      </td>
      <td className="px-3 py-2" data-label="Target">
        <ParameterValue side="target" value={item.targetValue} segments={diff?.target} />
      </td>
    </tr>
  );
}
