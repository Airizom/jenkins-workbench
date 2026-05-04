import * as React from "react";
import { Alert, AlertDescription } from "../../../../shared/webview/components/ui/alert";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../../../../shared/webview/components/ui/toggle-group";
import type {
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import type { PipelinePresentation } from "../../../shared/BuildDetailsPanelWebviewState";
import {
  getBuildDetailsPanelUiState,
  setBuildDetailsPanelUiState
} from "../../lib/buildDetailsPanelState";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { PipelineNodeLogPane } from "./PipelineNodeLogPane";
import { PipelineStagesSection } from "./PipelineStagesSection";
import { LoadingBanner } from "./pipelineStages/LoadingBanner";
import { PipelineStagesPlaceholder } from "./pipelineStages/PipelineStagesPlaceholder";

const { Suspense, lazy, useEffect, useState } = React;

const DEFAULT_PRESENTATION: PipelinePresentation = "list";
const LazyPipelineGraphSection = lazy(async () => {
  const module = await import("./pipelineGraph/PipelineGraphSection");
  return { default: module.PipelineGraphSection };
});

interface PersistedBuildDetailsState {
  pipelinePresentation?: PipelinePresentation;
  selectedGraphStageKey?: string;
  selectedPipelineLogTarget?: PipelineLogTargetViewModel;
}

export function PipelineSection({
  stages,
  pipelineNodeLog,
  pipelineNodeLogHtmlModel,
  loading,
  onRestartStage,
  onSelectPipelineLog,
  onClearPipelineLog,
  onExportPipelineLog,
  onOpenExternal,
  isActive
}: {
  stages: PipelineStageViewModel[];
  pipelineNodeLog: PipelineNodeLogViewModel;
  pipelineNodeLogHtmlModel?: ConsoleHtmlModel;
  loading: boolean;
  onRestartStage: (stageName: string) => void;
  onSelectPipelineLog: (target: PipelineLogTargetViewModel) => void;
  onClearPipelineLog: () => void;
  onExportPipelineLog: () => void;
  onOpenExternal: (url: string) => void;
  isActive: boolean;
}) {
  const [presentation, setPresentation] = useState<PipelinePresentation>(() =>
    readPresentationFromState()
  );
  const [selectedStageKey, setSelectedStageKey] = useState<string | undefined>(() =>
    readSelectedStageKeyFromState()
  );
  const [restoredLogTarget] = useState<PipelineLogTargetViewModel | undefined>(() =>
    readSelectedPipelineLogTargetFromState()
  );
  const [fallbackNotice, setFallbackNotice] = useState<string | undefined>();
  const hasStages = stages.length > 0;
  const showPlaceholder = loading && !hasStages;

  useEffect(() => {
    persistBuildDetailsUiState({
      pipelinePresentation: presentation,
      selectedGraphStageKey: selectedStageKey,
      selectedPipelineLogTarget: pipelineNodeLog.target
    });
  }, [presentation, selectedStageKey, pipelineNodeLog.target]);

  useEffect(() => {
    if (pipelineNodeLog.target || !restoredLogTarget) {
      return;
    }
    onSelectPipelineLog(restoredLogTarget);
  }, [pipelineNodeLog.target, restoredLogTarget, onSelectPipelineLog]);

  if (!loading && !hasStages) {
    return null;
  }

  return (
    <section id="pipeline-section" className="space-y-3" aria-busy={loading}>
      <div className="flex flex-col gap-2 rounded-lg border border-card-border bg-card px-3 py-2 shadow-widget sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Pipeline</div>
          <div className="text-xs text-muted-foreground">
            Switch between the current list view and a stage graph derived from the existing stage
            payload.
          </div>
        </div>
        <ToggleGroup
          type="single"
          value={presentation}
          onValueChange={(value) => {
            if (value === "graph" || value === "list") {
              setFallbackNotice(undefined);
              setPresentation(value);
            }
          }}
          aria-label="Pipeline presentation"
        >
          <ToggleGroupItem value="graph" aria-label="Graph view">
            Graph
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            List
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {fallbackNotice ? (
        <Alert variant="info" className="py-2">
          <AlertDescription>{fallbackNotice}</AlertDescription>
        </Alert>
      ) : null}

      {loading && hasStages ? <LoadingBanner /> : null}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.9fr)]">
        <div className="min-w-0">
          {showPlaceholder ? (
            <PipelineStagesPlaceholder />
          ) : presentation === "graph" ? (
            <Suspense
              fallback={
                <div className="rounded-lg border border-card-border bg-card px-4 py-8 text-sm text-muted-foreground shadow-widget">
                  Loading graph tools…
                </div>
              }
            >
              <LazyPipelineGraphSection
                stages={stages}
                selectedStageKey={selectedStageKey}
                onSelectStage={(stageKey) => {
                  setSelectedStageKey(stageKey);
                  const stage = stageKey ? findStageByKey(stages, stageKey) : undefined;
                  const target = stage?.logTarget;
                  if (target) {
                    onSelectPipelineLog(target);
                  }
                }}
                onRestartStage={onRestartStage}
                onSelectPipelineLog={onSelectPipelineLog}
                onGraphError={() => {
                  setFallbackNotice(
                    "Graph layout failed for the current pipeline. Showing list view instead."
                  );
                  setPresentation("list");
                }}
              />
            </Suspense>
          ) : (
            <PipelineStagesSection
              stages={stages}
              loading={loading}
              onRestartStage={onRestartStage}
              onSelectPipelineLog={onSelectPipelineLog}
            />
          )}
        </div>
        <PipelineNodeLogPane
          log={pipelineNodeLog}
          htmlModel={pipelineNodeLogHtmlModel}
          onClear={onClearPipelineLog}
          onExport={onExportPipelineLog}
          onOpenExternal={onOpenExternal}
          isActive={isActive}
        />
      </div>
    </section>
  );
}

function readPresentationFromState(): PipelinePresentation {
  const persisted = getBuildDetailsPanelUiState() as PersistedBuildDetailsState;
  const presentation = persisted.pipelinePresentation;
  return presentation === "graph" || presentation === "list" ? presentation : DEFAULT_PRESENTATION;
}

function readSelectedStageKeyFromState(): string | undefined {
  const persisted = getBuildDetailsPanelUiState() as PersistedBuildDetailsState;
  const key = persisted.selectedGraphStageKey;
  return typeof key === "string" && key.trim().length > 0 ? key : undefined;
}

function readSelectedPipelineLogTargetFromState(): PipelineLogTargetViewModel | undefined {
  const persisted = getBuildDetailsPanelUiState() as PersistedBuildDetailsState;
  return persisted.selectedPipelineLogTarget;
}

function persistBuildDetailsUiState(nextState: {
  pipelinePresentation: PipelinePresentation;
  selectedGraphStageKey?: string;
  selectedPipelineLogTarget?: PipelineLogTargetViewModel;
}): void {
  setBuildDetailsPanelUiState(nextState);
}

function findStageByKey(
  stages: PipelineStageViewModel[],
  key: string
): PipelineStageViewModel | undefined {
  for (const stage of stages) {
    if (stage.key === key) {
      return stage;
    }
    const branch = findStageByKey(stage.parallelBranches, key);
    if (branch) {
      return branch;
    }
  }
  return undefined;
}
