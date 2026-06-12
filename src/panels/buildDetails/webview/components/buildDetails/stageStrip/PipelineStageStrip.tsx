import { Skeleton } from "../../../../../shared/webview/components/ui/skeleton";
import { StageStripSegmentButton } from "./StageStripSegmentButton";
import type { StageStripSegment } from "./stageStripModel";
import { isDenseStrip } from "./stageStripModel";

type PipelineStageStripProps = {
  segments: StageStripSegment[];
  loading: boolean;
  onSelectStage: (segment: StageStripSegment) => void;
};
export function PipelineStageStrip({
  segments,
  loading,
  onSelectStage
}: PipelineStageStripProps): JSX.Element | null {
  if (segments.length === 0 && !loading) {
    return null;
  }

  if (segments.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-2">
        <div className="flex items-stretch gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-6 flex-1 max-w-[150px]" />
          ))}
        </div>
      </div>
    );
  }

  const dense = isDenseStrip(segments.length);

  return (
    <nav aria-label="Pipeline stages" className="mx-auto w-full max-w-6xl px-4 pb-2">
      <div className="stage-strip flex items-stretch gap-1 overflow-x-auto">
        {segments.map((segment) => (
          <StageStripSegmentButton
            key={segment.key}
            segment={segment}
            dense={dense}
            onSelect={onSelectStage}
          />
        ))}
      </div>
    </nav>
  );
}
