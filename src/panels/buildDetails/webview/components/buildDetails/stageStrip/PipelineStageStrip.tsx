import * as React from "react";
import { Skeleton } from "../../../../../shared/webview/components/ui/skeleton";
import {
  revealItem,
  useHorizontalOverflow
} from "../../../../../shared/webview/hooks/useHorizontalOverflow";
import { StageStripSegmentButton } from "./StageStripSegmentButton";
import type { StageStripSegment } from "./stageStripModel";
import { findAttentionSegmentKey, isDenseStrip } from "./stageStripModel";

const ATTENTION_SEGMENT_SELECTOR = "[data-strip-attention]";

type PipelineStageStripProps = {
  segments: StageStripSegment[];
  loading: boolean;
  onSelectStage: (segment: StageStripSegment) => void;
};
export function PipelineStageStrip({
  segments,
  loading,
  onSelectStage
}: PipelineStageStripProps): React.JSX.Element | null {
  if (segments.length === 0 && !loading) {
    return null;
  }

  if (segments.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-2">
        <div className="flex items-stretch gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-6 flex-1" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <nav aria-label="Pipeline stages" className="mx-auto w-full max-w-6xl px-4 pb-2">
      <StageStripTrack segments={segments} onSelectStage={onSelectStage} />
    </nav>
  );
}

// Mounted only once segments exist, so the overflow hook observes a real element.
function StageStripTrack({
  segments,
  onSelectStage
}: Omit<PipelineStageStripProps, "loading">): React.JSX.Element {
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  // Edge fades show the strip is clipped.
  useHorizontalOverflow(stripRef);
  const dense = isDenseStrip(segments.length);
  const attentionKey = findAttentionSegmentKey(segments);

  // Scroll the failed (or running) stage into view so narrow panels never hide
  // the stage that matters. Keyed on the stage rather than the hook's
  // active-item tracking: segment tooltips toggle `data-state` on hover, which
  // would snap the strip back while the user scrolls through other stages.
  React.useEffect(() => {
    const strip = stripRef.current;
    const item = attentionKey
      ? strip?.querySelector<HTMLElement>(ATTENTION_SEGMENT_SELECTOR)
      : undefined;
    if (strip && item) {
      revealItem(strip, item, "auto");
    }
  }, [attentionKey]);

  return (
    <div
      ref={stripRef}
      className="scrollbar-thin overflow-fade-x flex items-stretch gap-1 overflow-x-auto"
    >
      {segments.map((segment) => (
        <StageStripSegmentButton
          key={segment.key}
          segment={segment}
          dense={dense}
          attention={segment.key === attentionKey}
          onSelect={onSelectStage}
        />
      ))}
    </div>
  );
}
