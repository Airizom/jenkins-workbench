import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import {
  resolveResultIconTextClass,
  resolveStatusAccentClass
} from "../../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../../shared/webview/lib/utils";
import { getStageIcon } from "../pipelineStages/PipelineStageIcons";
import type { StageStripSegment } from "./stageStripModel";
import { describeSegmentAria, describeSegmentDetail } from "./stageStripModel";

const DENSE_GLYPH_STATUSES = new Set(["failure", "unstable", "aborted"]);

type StageStripSegmentButtonProps = {
  segment: StageStripSegment;
  dense: boolean;
  onSelect: (segment: StageStripSegment) => void;
};
export function StageStripSegmentButton({
  segment,
  dense,
  onSelect
}: StageStripSegmentButtonProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(segment)}
          aria-label={describeSegmentAria(segment)}
          className={cn(
            "flex min-w-0 flex-col justify-end gap-1 rounded-sm px-1 py-1",
            "hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            dense ? "w-5 flex-none" : "flex-1 min-w-[56px] max-w-[150px]"
          )}
        >
          {dense ? <DenseStatusGlyph segment={segment} /> : <SegmentLabel segment={segment} />}
          <span
            className={cn(
              "h-1.5 w-full rounded-full",
              resolveStatusAccentClass(segment.statusClass),
              segment.statusClass === "running" && "stage-strip-bar--running"
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-medium">{segment.name}</div>
        <div className="text-muted-foreground">{describeSegmentDetail(segment)}</div>
      </TooltipContent>
    </Tooltip>
  );
}

// Dense segments hide labels, so surface bad outcomes with a status glyph.
function DenseStatusGlyph({ segment }: { segment: StageStripSegment }): JSX.Element | null {
  if (!DENSE_GLYPH_STATUSES.has(segment.statusClass)) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex w-full items-center justify-center",
        resolveResultIconTextClass(segment.statusClass)
      )}
    >
      {getStageIcon(segment.statusClass)}
    </span>
  );
}

function SegmentLabel({ segment }: { segment: StageStripSegment }): JSX.Element {
  return (
    <span className="flex w-full items-center gap-1 text-[11px] leading-tight text-muted-foreground">
      <span className="truncate">{segment.name}</span>
      {segment.branchCount > 0 ? (
        <span className="shrink-0 opacity-70">×{segment.branchCount}</span>
      ) : null}
    </span>
  );
}
