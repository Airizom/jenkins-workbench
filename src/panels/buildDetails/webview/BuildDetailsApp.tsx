import * as React from "react";
import type { BuildDetailsViewModel } from "../shared/BuildDetailsContracts";
import { BuildFailureInsightsSection } from "./components/buildDetails/BuildFailureInsightsSection";
import { BuildSummaryCard } from "./components/buildDetails/BuildSummaryCard";
import { ConsoleOutputSection } from "./components/buildDetails/ConsoleOutputSection";
import { PendingInputsSection } from "./components/buildDetails/PendingInputsSection";
import { PipelineStagesSection } from "./components/buildDetails/PipelineStagesSection";
import { StatusPill } from "./components/buildDetails/StatusPill";
import { Alert, AlertDescription } from "../../shared/webview/components/ui/alert";
import { Button } from "../../shared/webview/components/ui/button";
import { LoadingSkeleton } from "../../shared/webview/components/ui/loading-skeleton";
import { Progress } from "../../shared/webview/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/webview/components/ui/tabs";
import {
  ArrowUpIcon,
  CalendarIcon,
  ClockIcon,
  ExternalLinkIcon
} from "../../shared/webview/icons";
import { useBuildDetailsInteractions } from "./hooks/useBuildDetailsInteractions";
import { useBuildDetailsMessages } from "./hooks/useBuildDetailsMessages";
import { useScrollToTopButton } from "./hooks/useScrollToTopButton";
import { buildDetailsReducer, buildInitialState, DEFAULT_INSIGHTS } from "./state/buildDetailsState";

const { useEffect, useReducer, useMemo, useState } = React;

export function BuildDetailsApp({ initialState }: { initialState: BuildDetailsViewModel }) {
  const [state, dispatch] = useReducer(buildDetailsReducer, initialState, buildInitialState);
  const postMessage = useBuildDetailsInteractions();
  useBuildDetailsMessages(dispatch);
  const { showButton, scrollToTop } = useScrollToTopButton();

  const insights = state.insights ?? DEFAULT_INSIGHTS;
  const isRunning = state.resultClass === "running";
  const hasPendingInputs = state.pendingInputs.length > 0;
  const hasPipelineStages = state.pipelineStages.length > 0 || state.pipelineStagesLoading;
  const buildUrl = state.buildUrl;

  const defaultTab = useMemo(() => {
    if (hasPendingInputs) {
      return "inputs";
    }
    if (hasPipelineStages) {
      return "pipeline";
    }
    return "console";
  }, [hasPendingInputs, hasPipelineStages]);

  const availableTabs = useMemo(() => {
    const tabs = [];
    if (hasPendingInputs) {
      tabs.push("inputs");
    }
    if (hasPipelineStages) {
      tabs.push("pipeline");
    }
    tabs.push("console", "insights");
    return tabs;
  }, [hasPendingInputs, hasPipelineStages]);

  const [selectedTab, setSelectedTab] = useState(defaultTab);

  useEffect(() => {
    if (!availableTabs.includes(selectedTab)) {
      setSelectedTab(defaultTab);
    }
  }, [availableTabs, defaultTab, selectedTab]);

  if (state.loading) {
    return <LoadingSkeleton variant="build" />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky-header">
        {isRunning ? (
          <Progress indeterminate className="h-0.5 rounded-none" />
        ) : null}
        <div className="mx-auto max-w-5xl px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <h1 className="text-base font-semibold" id="detail-title">
                  {state.displayName}
                </h1>
                <StatusPill
                  id="detail-result"
                  label={state.resultLabel}
                  status={state.resultClass}
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5" id="detail-duration">
                  <ClockIcon />
                  {state.durationLabel}
                </span>
                <span className="inline-flex items-center gap-1.5" id="detail-timestamp">
                  <CalendarIcon />
                  {state.timestampLabel}
                </span>
                {state.culpritsLabel !== "—" && state.culpritsLabel !== "None" ? (
                  <span className="inline-flex items-center gap-1.5" id="detail-culprits">
                    <span className="text-muted-foreground">by</span>
                    {state.culpritsLabel}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!buildUrl) {
                    return;
                  }
                  postMessage({ type: "openExternal", url: buildUrl });
                }}
                disabled={!buildUrl}
                className="gap-1.5"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
                Open in Jenkins
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-6">
        {state.errors.length > 0 ? (
          <Alert id="errors" variant="destructive" className="mb-6 flex flex-col gap-1.5">
            {state.errors.map((error) => (
              <AlertDescription className="text-[13px]" key={error}>
                {error}
              </AlertDescription>
            ))}
          </Alert>
        ) : null}

        <Tabs
          value={selectedTab}
          onValueChange={setSelectedTab}
          className="space-y-4"
        >
          <TabsList className="w-full justify-start">
            {hasPendingInputs ? (
              <TabsTrigger value="inputs" className="relative">
                Pending Inputs
                <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning/20 px-1.5 text-xs font-medium text-warning">
                  {state.pendingInputs.length}
                </span>
              </TabsTrigger>
            ) : null}
            {hasPipelineStages ? (
              <TabsTrigger value="pipeline">
                Pipeline
                {state.pipelineStagesLoading ? (
                  <span className="ml-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                ) : null}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="console">Console</TabsTrigger>
            <TabsTrigger value="insights">
              {state.resultClass === "failure" || state.resultClass === "unstable"
                ? "Failure Analysis"
                : "Build Summary"}
            </TabsTrigger>
          </TabsList>

          {hasPendingInputs ? (
            <TabsContent value="inputs" className="space-y-4">
              <PendingInputsSection
                pendingInputs={state.pendingInputs}
                onApprove={(inputId) => postMessage({ type: "approveInput", inputId })}
                onReject={(inputId) => postMessage({ type: "rejectInput", inputId })}
              />
            </TabsContent>
          ) : null}

          {hasPipelineStages ? (
            <TabsContent value="pipeline" className="space-y-4" forceMount>
              <PipelineStagesSection
                stages={state.pipelineStages}
                loading={state.pipelineStagesLoading}
              />
            </TabsContent>
          ) : null}

          <TabsContent value="console" className="space-y-4" forceMount>
            <ConsoleOutputSection
              consoleText={state.consoleText}
              consoleHtmlModel={state.consoleHtmlModel}
              consoleTruncated={state.consoleTruncated}
              consoleMaxChars={state.consoleMaxChars}
              consoleError={state.consoleError}
              followLog={state.followLog}
              isActive={selectedTab === "console"}
              onToggleFollowLog={(value) => {
                dispatch({ type: "setFollowLog", value });
                postMessage({ type: "toggleFollowLog", value });
              }}
              onExportLogs={() => postMessage({ type: "exportConsole" })}
              onOpenExternal={(url) => postMessage({ type: "openExternal", url })}
            />
          </TabsContent>

          <TabsContent value="insights" className="space-y-4" forceMount>
            <BuildSummaryCard
              displayName={state.displayName}
              resultLabel={state.resultLabel}
              resultClass={state.resultClass}
              durationLabel={state.durationLabel}
              timestampLabel={state.timestampLabel}
              culpritsLabel={state.culpritsLabel}
            />
            <BuildFailureInsightsSection
              insights={insights}
              resultClass={state.resultClass}
              onArtifactAction={(action, artifact) =>
                postMessage({
                  type: "artifactAction",
                  action,
                  relativePath: artifact.relativePath,
                  fileName: artifact.fileName ?? undefined
                })
              }
            />
          </TabsContent>
        </Tabs>
      </main>

      {showButton && !state.followLog ? (
        <Button
          aria-label="Scroll to top"
          className="fixed bottom-6 right-6 z-50 rounded-full shadow-lg"
          onClick={scrollToTop}
          size="icon"
          title="Scroll to top"
          variant="secondary"
        >
          <ArrowUpIcon />
        </Button>
      ) : null}
    </div>
  );
}
