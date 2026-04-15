import * as React from "react";
import { LoadingSkeleton } from "../../shared/webview/components/ui/loading-skeleton";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import type { BuildDetailsViewModel } from "../shared/BuildDetailsContracts";
import { BuildDetailsErrorList } from "./components/buildDetails/BuildDetailsErrorList";
import { BuildDetailsHeader } from "./components/buildDetails/BuildDetailsHeader";
import { BuildDetailsScrollToTopButton } from "./components/buildDetails/BuildDetailsScrollToTopButton";
import { BuildDetailsTabs } from "./components/buildDetails/BuildDetailsTabs";
import { useBuildDetailsInteractions } from "./hooks/useBuildDetailsInteractions";
import { useBuildDetailsMessages } from "./hooks/useBuildDetailsMessages";
import { useBuildDetailsTabs } from "./hooks/useBuildDetailsTabs";
import { useScrollToTopButton } from "./hooks/useScrollToTopButton";
import {
  DEFAULT_COVERAGE_STATE,
  DEFAULT_INSIGHTS,
  buildDetailsReducer,
  buildInitialState
} from "./state/buildDetailsState";

const { useReducer } = React;

export function BuildDetailsApp({ initialState }: { initialState: BuildDetailsViewModel }) {
  const [state, dispatch] = useReducer(buildDetailsReducer, initialState, buildInitialState);
  const postMessage = useBuildDetailsInteractions();
  useBuildDetailsMessages(dispatch);
  const { showButton, scrollToTop } = useScrollToTopButton();

  const coverageState = state.coverageState ?? DEFAULT_COVERAGE_STATE;
  const insights = state.insights ?? DEFAULT_INSIGHTS;
  const isRunning = state.resultClass === "running";
  const hasPendingInputs = state.pendingInputs.length > 0;
  const hasPipelineStages = state.pipelineStages.length > 0 || state.pipelineStagesLoading;
  const hasTests = state.testState.summary.hasAnyResults || coverageState.showTab;
  const buildUrl = state.buildUrl;
  const { selectedTab, setSelectedTab } = useBuildDetailsTabs({
    hasPendingInputs,
    hasPipelineStages,
    hasTests
  });

  const handleOpenExternal = (url: string) => {
    postMessage({ type: "openExternal", url });
  };

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

  const handleExportConsole = () => {
    postMessage({ type: "exportConsole" });
  };

  if (state.loading && !state.hasLoaded) {
    return <LoadingSkeleton variant="build" />;
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col">
        <BuildDetailsHeader
          displayName={state.displayName}
          resultLabel={state.resultLabel}
          resultClass={state.resultClass}
          durationLabel={state.durationLabel}
          timestampLabel={state.timestampLabel}
          culpritsLabel={state.culpritsLabel}
          loading={Boolean(state.loading)}
          isRunning={isRunning}
          buildUrl={buildUrl}
          onOpenBuild={handleOpenBuild}
        />

        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-3">
          <BuildDetailsErrorList errors={state.errors} />
          <BuildDetailsTabs
            selectedTab={selectedTab}
            onTabChange={setSelectedTab}
            hasPendingInputs={hasPendingInputs}
            hasPipelineStages={hasPipelineStages}
            hasTests={hasTests}
            pendingInputs={state.pendingInputs}
            pipelineStages={state.pipelineStages}
            pipelineStagesLoading={state.pipelineStagesLoading}
            displayName={state.displayName}
            buildUrl={buildUrl}
            resultClass={state.resultClass}
            resultLabel={state.resultLabel}
            durationLabel={state.durationLabel}
            timestampLabel={state.timestampLabel}
            culpritsLabel={state.culpritsLabel}
            testsSummary={state.testState.summary}
            testResults={state.testState.results}
            coverageState={coverageState}
            insights={insights}
            consoleText={state.consoleText}
            consoleHtmlModel={state.consoleHtmlModel}
            consoleTruncated={state.consoleTruncated}
            consoleMaxChars={state.consoleMaxChars}
            consoleError={state.consoleError}
            followLog={state.followLog}
            isConsoleTabActive={selectedTab === "console"}
            onApproveInput={(inputId) => postMessage({ type: "approveInput", inputId })}
            onRejectInput={(inputId) => postMessage({ type: "rejectInput", inputId })}
            onRestartStage={(stageName) =>
              postMessage({ type: "restartPipelineFromStage", stageName })
            }
            onToggleFollowLog={handleToggleFollowLog}
            onExportLogs={handleExportConsole}
            onOpenExternal={handleOpenExternal}
            onArtifactAction={(action, artifact) =>
              postMessage({
                type: "artifactAction",
                action,
                relativePath: artifact.relativePath,
                fileName: artifact.fileName ?? undefined
              })
            }
            onReloadTestResults={() =>
              postMessage({
                type: "reloadTestReport",
                includeCaseLogs: true
              })
            }
            onOpenTestSource={(testCase) =>
              postMessage({
                type: "openTestSource",
                testName: testCase.name,
                className: testCase.className,
                suiteName: testCase.suiteName
              })
            }
          />
        </main>

        <BuildDetailsScrollToTopButton
          show={showButton && !state.followLog}
          onScrollToTop={scrollToTop}
        />

        <Toaster />
      </div>
    </TooltipProvider>
  );
}
