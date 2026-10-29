import * as React from "react";
import { HistoryProvider } from "../../jobHistory/webview/HistoryContext";
import { HistoryView } from "../../jobHistory/webview/HistoryView";
import { PanelInitialLoadingGate } from "../../shared/webview/components/PanelInitialLoadingGate";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import { useOpenExternalMessage } from "../../shared/webview/hooks/useOpenExternalMessage";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import type {
  BuildDetailsViewModel,
  PipelineLogTargetViewModel
} from "../shared/BuildDetailsContracts";
import { EMPTY_BUILD_NAVIGATION, EMPTY_BUILD_RELATIONSHIPS } from "../shared/BuildDetailsContracts";
import type {
  BuildDetailsIncomingMessage,
  BuildManagementMessage
} from "../shared/BuildDetailsPanelMessages";
import { buildArtifactActionMessage } from "./buildDetailsWebviewMessages";
import {
  BuildDetailsErrors,
  hasLoadedBuildHeader
} from "./components/buildDetails/BuildDetailsErrors";
import { BuildDetailsScrollToTopButton } from "./components/buildDetails/BuildDetailsScrollToTopButton";
import { BuildDetailsTabs } from "./components/buildDetails/BuildDetailsTabs";
import { BuildStatusHero } from "./components/buildDetails/hero/BuildStatusHero";
import type { PipelineStageRequest } from "./components/buildDetails/pipelineSectionState";
import { PipelineStageStrip } from "./components/buildDetails/stageStrip/PipelineStageStrip";
import type { StageStripSegment } from "./components/buildDetails/stageStrip/stageStripModel";
import {
  buildStageStripSegments,
  countFailedSegments
} from "./components/buildDetails/stageStrip/stageStripModel";
import { useBuildDetailsMessages } from "./hooks/useBuildDetailsMessages";
import { useBuildDetailsTabs } from "./hooks/useBuildDetailsTabs";
import { usePendingInputActions } from "./hooks/usePendingInputActions";
import { useScrollToTopButton } from "./hooks/useScrollToTopButton";
import {
  buildDetailsReducer,
  buildInitialState,
  DEFAULT_COVERAGE_STATE,
  DEFAULT_INSIGHTS
} from "./state/buildDetailsState";

const { useCallback, useMemo, useReducer, useState } = React;

export function BuildDetailsApp({ initialState }: { initialState: BuildDetailsViewModel }) {
  const [state, dispatch] = useReducer(buildDetailsReducer, initialState, buildInitialState);
  const postMessage: (message: BuildDetailsIncomingMessage) => void = postVsCodeMessage;
  const handleOpenExternal = useOpenExternalMessage(postMessage);
  useBuildDetailsMessages(dispatch);
  // The new document must install its message listener before the host republishes
  // transient navigation and relationship state after replacing the webview HTML.
  React.useEffect(() => {
    postVsCodeMessage({ type: "buildDetailsReady" } satisfies BuildDetailsIncomingMessage);
  }, []);
  const { showButton, scrollToTop } = useScrollToTopButton();

  const coverageState = state.coverageState ?? DEFAULT_COVERAGE_STATE;
  const insights = state.insights ?? DEFAULT_INSIGHTS;
  const isRunning = state.resultClass === "running";
  const hasPendingInputs = state.pendingInputs.length > 0;
  const hasPipelineStages = state.pipelineStages.length > 0 || state.pipelineStagesLoading;
  const hasTests = state.testState.summary.hasAnyResults || coverageState.showTab;
  const buildUrl = state.buildUrl;
  const pendingInputIds = useMemo(
    () => state.pendingInputs.map((input) => input.id),
    [state.pendingInputs]
  );
  const { selectedTab, setSelectedTab } = useBuildDetailsTabs({
    hasPendingInputs,
    pendingInputIds,
    hasPipelineStages,
    hasTests,
    detailsLoaded: state.hasLoaded
  });
  const startPendingInputAction = usePendingInputActions(
    dispatch,
    postMessage,
    state.processingInputActions
  );
  const awaitingInput = useMemo(
    () =>
      hasPendingInputs && isRunning
        ? { count: state.pendingInputs.length, message: state.pendingInputs[0]?.message ?? "" }
        : undefined,
    [hasPendingInputs, isRunning, state.pendingInputs]
  );

  const handleOpenBuild = () => {
    if (!buildUrl) {
      return;
    }
    handleOpenExternal(buildUrl);
  };

  const handleToggleFollowLog = (value: boolean) => {
    dispatch({ type: "setFollowLog", value });
    postMessage({ type: "toggleFollowLog", value });
  };

  // The extension host reports export, download, and reload outcomes itself,
  // so these handlers only post the request.
  const handleExportConsole = () => {
    postMessage({ type: "exportConsole" });
  };

  const handleCopyLink = () => {
    postMessage({ type: "copyBuildLink" });
  };

  const handleRetry = () => {
    postMessage({ type: "refreshBuildDetails" });
  };

  // Buttons stay disabled until the extension reports `buildManagementActionComplete`,
  // so a confirmation or quick pick left open cannot be opened twice.
  const handleBuildManagement = (message: BuildManagementMessage) => {
    if (state.managementBusy) {
      return;
    }
    dispatch({ type: "startBuildManagementAction" });
    postMessage(message);
  };

  // Stable identity: PipelineSection uses this callback in effect dependencies.
  const handleSelectPipelineLog = useCallback(
    (target: PipelineLogTargetViewModel) => {
      postMessage({ type: "selectPipelineLogNode", target });
    },
    [postMessage]
  );

  const isAwaitingInput = awaitingInput !== undefined;
  const stripSegments = useMemo(
    () => buildStageStripSegments(state.pipelineStages, isAwaitingInput),
    [state.pipelineStages, isAwaitingInput]
  );
  const stripFailedCount = useMemo(() => countFailedSegments(stripSegments), [stripSegments]);

  // Strip clicks go through the Pipeline tab's own selection path (expand or
  // select the stage, open its log, reveal it) rather than posting a log
  // request here, so the tab's default stage pick cannot override them.
  const [stageRequest, setStageRequest] = useState<PipelineStageRequest | undefined>();
  const handleStripStageSelect = useCallback(
    (segment: StageStripSegment) => {
      setSelectedTab("pipeline");
      setStageRequest((previous) => ({ stageKey: segment.key, id: (previous?.id ?? 0) + 1 }));
    },
    [setSelectedTab]
  );

  if (state.loading && !state.hasLoaded) {
    return (
      <PanelInitialLoadingGate
        loading={state.loading}
        hasLoaded={state.hasLoaded}
        variant="build"
      />
    );
  }

  return (
    <HistoryProvider>
      <TooltipProvider>
        <div className="min-h-screen flex flex-col">
          <BuildStatusHero
            navigation={state.navigation ?? EMPTY_BUILD_NAVIGATION}
            onNavigateBuild={(direction) => postMessage({ type: "navigateBuild", direction })}
            displayName={state.displayName}
            description={state.description}
            keptForever={state.keptForever}
            canManage={state.canManage}
            canDelete={state.canDelete}
            managementBusy={state.managementBusy}
            onBuildManagement={handleBuildManagement}
            resultLabel={state.resultLabel}
            resultClass={state.resultClass}
            durationLabel={state.durationLabel}
            timestampLabel={state.timestampLabel}
            culpritsLabel={state.culpritsLabel}
            loading={Boolean(state.loading)}
            isRunning={isRunning}
            buildUrl={buildUrl}
            testsSummary={state.testState.summary}
            stageCount={stripSegments.length}
            awaitingInput={awaitingInput}
            onReviewInputs={selectedTab === "inputs" ? undefined : () => setSelectedTab("inputs")}
            onOpenBuild={handleOpenBuild}
            onCopyLink={handleCopyLink}
          >
            <PipelineStageStrip
              segments={stripSegments}
              loading={state.pipelineStagesLoading}
              onSelectStage={handleStripStageSelect}
            />
          </BuildStatusHero>

          {/* Bottom padding keeps the floating scroll-to-top button clear of the
           * last row's controls (for example an artifact's download button). */}
          <main
            className="flex-1 mx-auto w-full max-w-6xl px-4 pt-3 pb-16"
            aria-busy={state.loading}
          >
            <BuildDetailsErrors
              errors={state.errors}
              buildLoaded={hasLoadedBuildHeader(state)}
              onRetry={handleRetry}
            />
            {/* Failure history only analyzes finished builds. */}
            {isRunning ? null : <HistoryView embedded />}
            <BuildDetailsTabs
              relatedBuilds={{
                relationships: state.relationships ?? EMPTY_BUILD_RELATIONSHIPS,
                navigationBusy: state.navigation?.busy,
                onExpandedChange: (expanded) =>
                  postMessage({ type: "setRelatedBuildsExpanded", expanded }),
                onRefresh: () => postMessage({ type: "refreshRelatedBuilds" }),
                onOpenBuild: (targetId) => postMessage({ type: "openRelatedBuild", targetId })
              }}
              selectedTab={selectedTab}
              onTabChange={setSelectedTab}
              hasPendingInputs={hasPendingInputs}
              hasPipelineStages={hasPipelineStages}
              hasTests={hasTests}
              pendingInputs={state.pendingInputs}
              processingInputActions={state.processingInputActions}
              pipelineStages={state.pipelineStages}
              pipelineNodeLog={state.pipelineNodeLog}
              pipelineNodeLogHtmlModel={state.pipelineNodeLogHtmlModel}
              pipelineStagesLoading={state.pipelineStagesLoading}
              stripFailedCount={stripFailedCount}
              stageRequest={stageRequest}
              buildUrl={buildUrl}
              resultLabel={state.resultLabel}
              resultClass={state.resultClass}
              durationLabel={state.durationLabel}
              timestampLabel={state.timestampLabel}
              testsSummary={state.testState.summary}
              testResults={state.testState.results}
              coverageState={coverageState}
              insights={insights}
              diagnostics={state.diagnostics}
              consoleText={state.consoleText}
              consoleHtmlModel={state.consoleHtmlModel}
              consoleTruncated={state.consoleTruncated}
              consoleMaxChars={state.consoleMaxChars}
              consoleError={state.consoleError}
              followLog={state.followLog}
              onApproveInput={(inputId) => startPendingInputAction(inputId, "approve")}
              onRejectInput={(inputId) => startPendingInputAction(inputId, "reject")}
              onOpenPendingInputInJenkins={(inputId) =>
                postMessage({ type: "openPendingInputInJenkins", inputId })
              }
              onRestartStage={(stageName) =>
                postMessage({ type: "restartPipelineFromStage", stageName })
              }
              onSelectPipelineLog={handleSelectPipelineLog}
              onClearPipelineLog={() => postMessage({ type: "clearPipelineLogNode" })}
              onExportPipelineLog={() => postMessage({ type: "exportPipelineNodeLog" })}
              onToggleFollowLog={handleToggleFollowLog}
              onExportLogs={handleExportConsole}
              onOpenExternal={handleOpenExternal}
              onDownloadAllArtifacts={() => postMessage({ type: "downloadAllArtifacts" })}
              onArtifactAction={(action, artifact) =>
                postMessage(buildArtifactActionMessage(action, artifact))
              }
              onReloadTestResults={() =>
                postMessage({ type: "reloadTestReport", includeCaseLogs: true })
              }
              onOpenTestSource={(testCase) =>
                postMessage({
                  type: "openTestSource",
                  testName: testCase.name,
                  className: testCase.className,
                  suiteName: testCase.suiteName
                })
              }
              onOpenDiagnosticSource={(targetId) =>
                postMessage({ type: "openDiagnosticSource", targetId })
              }
              onShowDiagnosticProblems={() => postMessage({ type: "showBuildDiagnosticProblems" })}
              onConfigureBuildDiagnostics={() => postMessage({ type: "configureBuildDiagnostics" })}
            />
          </main>

          {/* Hidden while a running build follows the log (the page keeps
           * jumping to the newest output), and on the Console tab, whose log
           * scrolls itself and has its own scroll-to-top control in the same
           * corner. */}
          <BuildDetailsScrollToTopButton
            show={showButton && !(isRunning && state.followLog) && selectedTab !== "console"}
            onScrollToTop={scrollToTop}
          />

          <Toaster />
        </div>
      </TooltipProvider>
    </HistoryProvider>
  );
}
