import type * as React from "react";
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
import {
  describeSegmentAria,
  describeSegmentBranches,
  describeSegmentDetail,
  describeSegmentTitle
} from "./stageStripModel";

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
}: StageStripSegmentButtonProps): React.JSX.Element {
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
            // Labelled segments keep a readable minimum width; the strip
            // scrolls horizontally instead of truncating names to a glyph.
            dense ? "w-5 flex-none" : "min-w-24 max-w-[160px] flex-1 shrink-0"
          )}
        >
          {dense ? <DenseStatusGlyph segment={segment} /> : <SegmentLabel segment={segment} />}
          <span
            className={cn(
              "h-1.5 w-full rounded-full",
              resolveStatusAccentClass(segment.statusClass),
              segment.statusClass === "running" && "stage-strip-bar--running",
              segment.statusClass === "neutral" && "stage-strip-bar--not-run"
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-medium">{describeSegmentTitle(segment)}</div>
        <div className="text-muted-foreground">{describeSegmentDetail(segment)}</div>
      </TooltipContent>
    </Tooltip>
  );
}

// Dense segments hide labels, so surface bad outcomes with a status glyph; labelled
// segments always show one so status is never conveyed by color alone.
function DenseStatusGlyph({ segment }: { segment: StageStripSegment }): React.JSX.Element | null {
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

function SegmentLabel({ segment }: { segment: StageStripSegment }): React.JSX.Element {
  const branches = describeSegmentBranches(segment);
  const glyph = getStageIcon(segment.statusClass);
  return (
    <span className="flex w-full items-center gap-1 text-caption leading-tight text-muted-foreground">
      {glyph ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-3 w-3 shrink-0 items-center justify-center",
            resolveResultIconTextClass(segment.statusClass)
          )}
        >
          {glyph}
        </span>
      ) : null}
      <span className="truncate">{segment.name}</span>
      {branches ? (
        <span className="shrink-0 opacity-70" aria-hidden="true">
          ×{segment.branchCount}
        </span>
      ) : null}
    </span>
  );
}
