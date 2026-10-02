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
import { useTabsBarHeightVariable } from "../../hooks/useTabsBarHeightVariable";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { PipelineNodeLogPane } from "./PipelineNodeLogPane";
import { PipelineStagesSection } from "./PipelineStagesSection";
import type { PipelineSectionBodyKind } from "./pipelineSectionModel";
import { canFollowPipelineNodeLog, type PipelineStageRequest } from "./pipelineSectionState";
import { LoadingBanner } from "./pipelineStages/LoadingBanner";
import { PipelineStagesPlaceholder } from "./pipelineStages/PipelineStagesPlaceholder";
import { usePipelineLogPaneReveal } from "./usePipelineLogPaneReveal";
import { usePipelineSectionState } from "./usePipelineSectionState";

const { Suspense, lazy, useCallback } = React;

const PRESENTATION_HINTS: Record<PipelinePresentation, string> = {
  list: "Expand a stage to see its steps, then open a stage or step log.",
  graph: "Select a stage to inspect it and open its log."
};

/** Brings a requested stage on screen: its list row, else the graph canvas. */
function scrollPipelineStageIntoView(stageKey: string): void {
  // Wait a frame so the pipeline tab content is visible before scrolling.
  requestAnimationFrame(() => {
    const element =
      document.querySelector(`#pipeline-section [data-stage-key="${CSS.escape(stageKey)}"]`) ??
      document.querySelector("#pipeline-section .pipeline-graph-canvas") ??
      document.getElementById("pipeline-section");
    if (!element) {
      return;
    }
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    element.scrollIntoView({ behavior, block: "center" });
  });
}

const LazyPipelineGraphSection = lazy(async () => {
  const module = await import("./pipelineGraph/PipelineGraphSection");
  return { default: module.PipelineGraphSection };
});

function PipelineSectionHeader({
  presentation,
  onPresentationChange
}: {
  presentation: PipelinePresentation;
  onPresentationChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-card-border bg-card px-3 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <WorkflowIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <div className="text-sm font-semibold">Pipeline</div>
          <div className="text-xs text-muted-foreground">
            Stages and steps for this run. {PRESENTATION_HINTS[presentation]}
          </div>
        </div>
      </div>
      <ToggleGroup
        type="single"
        value={presentation}
        onValueChange={onPresentationChange}
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
  );
}

type PipelineSectionProps = {
  stages: PipelineStageViewModel[];
  pipelineNodeLog: PipelineNodeLogViewModel;
  pipelineNodeLogHtmlModel?: ConsoleHtmlModel;
  loading: boolean;
  onRestartStage: (stageName: string) => void;
  onSelectPipelineLog: (target: PipelineLogTargetViewModel) => void;
  onClearPipelineLog: () => void;
  onExportPipelineLog: () => void;
  onOpenExternal: (url: string) => void;
  isRunning: boolean;
  isActive: boolean;
  /** Stage to open, from the hero stage strip. */
  stageRequest?: PipelineStageRequest;
};

function PipelineFallbackNotice({ notice }: { notice: string }): React.JSX.Element {
  return (
    <Alert variant="info" className="py-2">
      <AlertDescription>{notice}</AlertDescription>
    </Alert>
  );
}

function PipelineSectionLogPane({
  paneRef,
  headingRef,
  ...props
}: PipelineSectionProps & {
  paneRef: React.Ref<HTMLElement>;
  headingRef: React.Ref<HTMLHeadingElement>;
}) {
  const { stages, pipelineNodeLog, onSelectPipelineLog } = props;
  const handleRetryPipelineLog = () => {
    const target = pipelineNodeLog.target;
    if (target) {
      onSelectPipelineLog(target);
    }
  };

  return (
    <PipelineNodeLogPane
      log={pipelineNodeLog}
      htmlModel={props.pipelineNodeLogHtmlModel}
      canFollow={canFollowPipelineNodeLog(stages, pipelineNodeLog, props.isRunning)}
      paneRef={paneRef}
      headingRef={headingRef}
      onClear={props.onClearPipelineLog}
      onRetry={handleRetryPipelineLog}
      onExport={props.onExportPipelineLog}
      onOpenExternal={props.onOpenExternal}
      isActive={props.isActive}
    />
  );
}

export function PipelineSection(props: PipelineSectionProps) {
  const { stages, pipelineNodeLog, loading, onSelectPipelineLog, isRunning, isActive } = props;
  const { paneRef, headingRef, requestReveal } = usePipelineLogPaneReveal(
    pipelineNodeLog.target?.key
  );
  // A stacked log pane is revealed once its log loads; otherwise (or without a
  // log) the requested stage itself is scrolled into view.
  const revealRequestedStage = useCallback(
    (stage: PipelineStageViewModel) => {
      const target = stage.logTarget;
      if (target && requestReveal(target.key)) {
        return;
      }
      scrollPipelineStageIntoView(stage.key);
    },
    [requestReveal]
  );
  const state = usePipelineSectionState({
    stages,
    currentTarget: pipelineNodeLog.target,
    loading,
    isActive,
    isRunning,
    stageRequest: props.stageRequest,
    onSelectPipelineLog,
    onStageRequestOpened: revealRequestedStage
  });

  useTabsBarHeightVariable();

  const handleUserSelectPipelineLog = (target: PipelineLogTargetViewModel) => {
    state.markUserSelection();
    onSelectPipelineLog(target);
    requestReveal(target.key);
  };

  if (state.view.hidden) {
    return null;
  }

  return (
    <section id="pipeline-section" className="space-y-3" aria-busy={loading}>
      <PipelineSectionHeader
        presentation={state.presentation}
        onPresentationChange={state.changePresentation}
      />

      {state.fallbackNotice ? <PipelineFallbackNotice notice={state.fallbackNotice} /> : null}

      {state.view.showLoadingBanner ? <LoadingBanner /> : null}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.9fr)]">
        <div className="min-w-0">
          <PipelineSectionBody
            body={state.view.body}
            stages={stages}
            selectedStageKey={state.selectedStageKey}
            expandRequest={state.expandRequest}
            onSelectStage={state.selectGraphStage}
            onSyncSelectedStage={state.syncGraphStage}
            onRestartStage={props.onRestartStage}
            onSelectPipelineLog={handleUserSelectPipelineLog}
            onGraphError={state.fallBackToList}
          />
        </div>
        <PipelineSectionLogPane {...props} paneRef={paneRef} headingRef={headingRef} />
      </div>
    </section>
  );
}

function PipelineSectionBody({
  body,
  stages,
  selectedStageKey,
  expandRequest,
  onSelectStage,
  onSyncSelectedStage,
  onRestartStage,
  onSelectPipelineLog,
  onGraphError
}: {
  body: PipelineSectionBodyKind;
  stages: PipelineStageViewModel[];
  selectedStageKey?: string;
  expandRequest?: PipelineStageRequest;
  onSelectStage: (stageKey: string | undefined) => void;
  onSyncSelectedStage: (stageKey: string | undefined) => void;
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
          onSyncSelectedStage={onSyncSelectedStage}
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
      expandRequest={expandRequest}
      onRestartStage={onRestartStage}
      onSelectPipelineLog={onSelectPipelineLog}
    />
  );
}
