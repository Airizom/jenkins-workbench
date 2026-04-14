import * as React from "react";
import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";
import { PipelineGraphCanvas } from "./PipelineGraphCanvas";
import { PipelineGraphInspector } from "./PipelineGraphInspector";
import type { PipelineGraphLayoutResult } from "./pipelineGraphTypes";
import { usePipelineGraphLayout } from "./usePipelineGraphLayout";

const { useEffect, useState } = React;

export function PipelineGraphSection({
  stages,
  selectedStageKey,
  onSelectStage,
  onRestartStage,
  onGraphError
}: {
  stages: PipelineStageViewModel[];
  selectedStageKey?: string;
  onSelectStage: (stageKey: string | undefined) => void;
  onRestartStage: (stageName: string) => void;
  onGraphError: () => void;
}) {
  const graphLayout = usePipelineGraphLayout(stages, true);
  const [lastReadyLayout, setLastReadyLayout] = useState<PipelineGraphLayoutResult | undefined>();

  useEffect(() => {
    if (graphLayout.status === "ready") {
      setLastReadyLayout(graphLayout.layout);
    }
  }, [graphLayout]);

  useEffect(() => {
    if (graphLayout.status !== "ready") {
      return;
    }

    const [firstStageKey] = graphLayout.layout.model.orderedStageIds;
    if (!firstStageKey) {
      onSelectStage(undefined);
      return;
    }

    onSelectStage(
      selectedStageKey && graphLayout.layout.model.stageById.has(selectedStageKey)
        ? selectedStageKey
        : firstStageKey
    );
  }, [graphLayout, onSelectStage, selectedStageKey]);

  useEffect(() => {
    if (graphLayout.status === "error") {
      onGraphError();
    }
  }, [graphLayout, onGraphError]);

  const activeLayout = graphLayout.status === "ready" ? graphLayout.layout : lastReadyLayout;
  const selectedStage = activeLayout
    ? selectedStageKey
      ? activeLayout.model.stageById.get(selectedStageKey)
      : undefined
    : undefined;

  if (!activeLayout) {
    return (
      <div className="rounded-lg border border-card-border bg-card px-4 py-8 text-sm text-muted-foreground shadow-widget">
        Building graph layout from current stage data…
      </div>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
      <PipelineGraphCanvas
        layout={activeLayout}
        selectedStageKey={selectedStageKey}
        onSelectStage={(stageKey) => onSelectStage(stageKey)}
      />
      <PipelineGraphInspector stage={selectedStage} onRestartStage={onRestartStage} />
    </div>
  );
}
