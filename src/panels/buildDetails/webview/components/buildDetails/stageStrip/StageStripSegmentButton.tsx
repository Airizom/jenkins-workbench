import type * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import { PauseIcon } from "../../../../../shared/webview/icons";
import { resolveBuildResultStyle } from "../../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../../shared/webview/lib/utils";
import { getStageIcon } from "../pipelineStages/PipelineStageIcons";
import type { StageStripSegment } from "./stageStripModel";
import {
  describeSegmentAria,
  describeSegmentDetail,
  describeSegmentTitle
} from "./stageStripModel";

const DENSE_GLYPH_STATUSES = new Set(["failure", "unstable", "aborted"]);

// Paused segments share the warning tone of the hero's "Waiting for input" badge.
function resolveSegmentStyle(segment: StageStripSegment) {
  return resolveBuildResultStyle(segment.paused ? "unstable" : segment.statusClass);
}

function resolveSegmentIcon(segment: StageStripSegment): React.ReactNode {
  return segment.paused ? <PauseIcon className="h-3 w-3" /> : getStageIcon(segment.statusClass);
}

type StageStripSegmentButtonProps = {
  segment: StageStripSegment;
  dense: boolean;
  /** Scrolled into view when the strip overflows. */
  attention?: boolean;
  onSelect: (segment: StageStripSegment) => void;
};
export function StageStripSegmentButton({
  segment,
  dense,
  attention = false,
  onSelect
}: StageStripSegmentButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(segment)}
          aria-label={describeSegmentAria(segment)}
          data-strip-attention={attention ? "" : undefined}
          className={cn(
            "flex min-w-0 flex-col justify-end gap-1 rounded-sm px-1 py-1",
            "hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            // Labelled segments keep a readable minimum width; the strip
            // scrolls horizontally instead of truncating names to a glyph.
            dense ? "w-5 flex-none" : "min-w-24 flex-1 shrink-0"
          )}
        >
          {dense ? <DenseStatusGlyph segment={segment} /> : <SegmentLabel segment={segment} />}
          <span
            className={cn(
              "h-1.5 w-full rounded-full",
              resolveSegmentStyle(segment).accent,
              segment.statusClass === "running" && !segment.paused && "stage-strip-bar--running",
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
  if (!segment.paused && !DENSE_GLYPH_STATUSES.has(segment.statusClass)) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex w-full items-center justify-center",
        resolveSegmentStyle(segment).iconText
      )}
    >
      {resolveSegmentIcon(segment)}
    </span>
  );
}

function SegmentLabel({ segment }: { segment: StageStripSegment }): React.JSX.Element {
  const glyph = resolveSegmentIcon(segment);
  return (
    <span className="flex w-full items-center gap-1 text-caption leading-tight text-muted-foreground">
      {glyph ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-3 w-3 shrink-0 items-center justify-center",
            resolveSegmentStyle(segment).iconText
          )}
        >
          {glyph}
        </span>
      ) : null}
      <span className="truncate">{segment.name}</span>
      {segment.branchCount > 0 ? (
        <span className="shrink-0 opacity-70" aria-hidden="true">
          ×{segment.branchCount}
        </span>
      ) : null}
    </span>
  );
}
