import * as React from "react";
import { Alert, AlertDescription } from "../../../../shared/webview/components/ui/alert";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../../../../shared/webview/components/ui/toggle-group";
import { WorkflowIcon } from "../../../../shared/webview/icons";
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
import {
  derivePipelineSectionView,
  findStageLogTarget,
  isPipelinePresentation,
  type PipelineSectionBodyKind,
  planRestoredLogTarget,
  resolvePersistedPipelineLogTarget
} from "./pipelineSectionModel";
import { LoadingBanner } from "./pipelineStages/LoadingBanner";
import { PipelineStagesPlaceholder } from "./pipelineStages/PipelineStagesPlaceholder";

const { Suspense, lazy, useEffect, useRef, useState } = React;

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
  const restoredLogConsumedRef = useRef(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | undefined>();
  const view = derivePipelineSectionView(loading, stages.length, presentation);
  const canValidateLogTarget = view.canValidateLogTarget;

  useEffect(() => {
    const selectedPipelineLogTarget = resolvePersistedPipelineLogTarget({
      currentTarget: pipelineNodeLog.target,
      restoredTarget: restoredLogTarget,
      canValidateLogTarget,
      stages
    });
    setBuildDetailsPanelUiState({
      pipelinePresentation: presentation,
      selectedGraphStageKey: selectedStageKey,
      selectedPipelineLogTarget
    });
  }, [
    canValidateLogTarget,
    presentation,
    restoredLogTarget,
    selectedStageKey,
    stages,
    pipelineNodeLog.target
  ]);

  useEffect(() => {
    // Restore the persisted log selection at most once; marking it consumed
    // before firing keeps a later user close (target -> undefined) from
    // reopening the pane and avoids reposting the selection on every render.
    const plan = planRestoredLogTarget({
      alreadyConsumed: restoredLogConsumedRef.current,
      restoredTarget: restoredLogTarget,
      canValidateLogTarget,
      currentTarget: pipelineNodeLog.target,
      stages
    });
    if (!plan.consume) {
      return;
    }
    restoredLogConsumedRef.current = true;
    if (plan.targetToRestore) {
      onSelectPipelineLog(plan.targetToRestore);
    }
  }, [
    canValidateLogTarget,
    pipelineNodeLog.target,
    restoredLogTarget,
    stages,
    onSelectPipelineLog
  ]);

  const handlePresentationChange = (value: string) => {
    if (isPipelinePresentation(value)) {
      setFallbackNotice(undefined);
      setPresentation(value);
    }
  };

  const handleSelectGraphStage = (stageKey: string | undefined) => {
    setSelectedStageKey(stageKey);
    const target = findStageLogTarget(stages, stageKey);
    if (target) {
      onSelectPipelineLog(target);
    }
  };

  const handleGraphError = () => {
    setFallbackNotice("Graph layout failed for the current pipeline. Showing list view instead.");
    setPresentation("list");
  };

  if (view.hidden) {
    return null;
  }

  return (
    <section id="pipeline-section" className="space-y-3" aria-busy={loading}>
      <div className="flex flex-col gap-2 rounded-lg border border-card-border bg-card px-3 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <WorkflowIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Pipeline</div>
            <div className="text-xs text-muted-foreground">
              Stages and steps for this run. Select a stage to inspect its log.
            </div>
          </div>
        </div>
        <ToggleGroup
          type="single"
          value={presentation}
          onValueChange={handlePresentationChange}
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

      {view.showLoadingBanner ? <LoadingBanner /> : null}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.9fr)]">
        <div className="min-w-0">
          <PipelineSectionBody
            body={view.body}
            stages={stages}
            selectedStageKey={selectedStageKey}
            onSelectStage={handleSelectGraphStage}
            onRestartStage={onRestartStage}
            onSelectPipelineLog={onSelectPipelineLog}
            onGraphError={handleGraphError}
          />
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

function PipelineSectionBody({
  body,
  stages,
  selectedStageKey,
  onSelectStage,
  onRestartStage,
  onSelectPipelineLog,
  onGraphError
}: {
  body: PipelineSectionBodyKind;
  stages: PipelineStageViewModel[];
  selectedStageKey?: string;
  onSelectStage: (stageKey: string | undefined) => void;
  onRestartStage: (stageName: string) => void;
  onSelectPipelineLog: (target: PipelineLogTargetViewModel) => void;
  onGraphError: () => void;
}) {
  if (body === "placeholder") {
    return <PipelineStagesPlaceholder />;
  }
  if (body === "graph") {
    return (
      <Suspense
        fallback={
          <div className="rounded-lg border border-card-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">
            Loading graph tools…
          </div>
        }
      >
        <LazyPipelineGraphSection
          stages={stages}
          selectedStageKey={selectedStageKey}
          onSelectStage={onSelectStage}
          onRestartStage={onRestartStage}
          onSelectPipelineLog={onSelectPipelineLog}
          onGraphError={onGraphError}
        />
      </Suspense>
    );
  }
  return (
    <PipelineStagesSection
      stages={stages}
      onRestartStage={onRestartStage}
      onSelectPipelineLog={onSelectPipelineLog}
    />
  );
}

function readPresentationFromState(): PipelinePresentation {
  const persisted = getBuildDetailsPanelUiState() as PersistedBuildDetailsState;
  const presentation = persisted.pipelinePresentation;
  return isPipelinePresentation(presentation) ? presentation : DEFAULT_PRESENTATION;
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
