import * as React from "react";
import { Alert, AlertDescription } from "../../shared/webview/components/ui/alert";
import { Button } from "../../shared/webview/components/ui/button";
import { LoadingSkeleton } from "../../shared/webview/components/ui/loading-skeleton";
import { Progress } from "../../shared/webview/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/webview/components/ui/tabs";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "../../shared/webview/components/ui/tooltip";
import {
  AlertTriangleIcon,
  ArrowUpIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  PlayCircleIcon,
  StopCircleIcon,
  UserIcon,
  XCircleIcon
} from "../../shared/webview/icons";
import { cn } from "../../shared/webview/lib/utils";
import type { BuildDetailsViewModel } from "../shared/BuildDetailsContracts";
import { BuildFailureInsightsSection } from "./components/buildDetails/BuildFailureInsightsSection";
import { BuildSummaryCard } from "./components/buildDetails/BuildSummaryCard";
import { ConsoleOutputSection } from "./components/buildDetails/ConsoleOutputSection";
import { PendingInputsSection } from "./components/buildDetails/PendingInputsSection";
import { PipelineStagesSection } from "./components/buildDetails/PipelineStagesSection";
import { StatusPill } from "./components/buildDetails/StatusPill";
import { useBuildDetailsInteractions } from "./hooks/useBuildDetailsInteractions";
import { useBuildDetailsMessages } from "./hooks/useBuildDetailsMessages";
import { useScrollToTopButton } from "./hooks/useScrollToTopButton";
import {
  DEFAULT_INSIGHTS,
  buildDetailsReducer,
  buildInitialState
} from "./state/buildDetailsState";

const { useEffect, useReducer, useMemo, useState } = React;

const STATUS_ACCENT: Record<string, string> = {
  success: "bg-success",
  failure: "bg-failure",
  unstable: "bg-warning",
  aborted: "bg-aborted",
  running: "bg-warning",
  neutral: "bg-border"
};

function getStatusAccent(status: string): string {
  return STATUS_ACCENT[status] ?? STATUS_ACCENT.neutral;
}

function HeaderStatusIcon({ status }: { status: string }) {
  const size = "h-4 w-4";
  switch (status) {
    case "success":
      return <CheckCircleIcon className={size} />;
    case "failure":
      return <XCircleIcon className={size} />;
    case "unstable":
      return <AlertTriangleIcon className={size} />;
    case "aborted":
      return <StopCircleIcon className={size} />;
    case "running":
      return <PlayCircleIcon className={size} />;
    default:
      return null;
  }
}

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
    <TooltipProvider>
      <div className="min-h-screen flex flex-col">
        <header className="sticky-header">
          {isRunning ? <Progress indeterminate className="h-px rounded-none" /> : null}
          <div className="mx-auto max-w-6xl px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <HeaderStatusIcon status={state.resultClass} />
                <h1 className="text-sm font-semibold leading-tight truncate" id="detail-title">
                  {state.displayName}
                </h1>
                <StatusPill
                  id="detail-result"
                  label={state.resultLabel}
                  status={state.resultClass}
                />
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1" id="detail-duration">
                    <ClockIcon className="h-3 w-3" />
                    {state.durationLabel}
                  </span>
                  <span aria-hidden="true" className="opacity-30">|</span>
                  <span className="inline-flex items-center gap-1" id="detail-timestamp">
                    <CalendarIcon className="h-3 w-3" />
                    {state.timestampLabel}
                  </span>
                  {state.culpritsLabel !== "—" && state.culpritsLabel !== "None" ? (
                    <>
                      <span aria-hidden="true" className="opacity-30">|</span>
                      <span className="inline-flex items-center gap-1" id="detail-culprits">
                        <UserIcon className="h-3 w-3" />
                        {state.culpritsLabel}
                      </span>
                    </>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!buildUrl) {
                      return;
                    }
                    postMessage({ type: "openExternal", url: buildUrl });
                  }}
                  disabled={!buildUrl}
                  aria-label="Open in Jenkins"
                  className="gap-1 h-7 px-2 text-xs"
                >
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Jenkins</span>
                </Button>
              </div>
            </div>
            <div className="sm:hidden flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1" id="detail-duration-sm">
                <ClockIcon className="h-3 w-3" />
                {state.durationLabel}
              </span>
              <span aria-hidden="true" className="opacity-30">|</span>
              <span className="inline-flex items-center gap-1" id="detail-timestamp-sm">
                <CalendarIcon className="h-3 w-3" />
                {state.timestampLabel}
              </span>
              {state.culpritsLabel !== "—" && state.culpritsLabel !== "None" ? (
                <>
                  <span aria-hidden="true" className="opacity-30">|</span>
                  <span className="inline-flex items-center gap-1" id="detail-culprits-sm">
                    <UserIcon className="h-3 w-3" />
                    {state.culpritsLabel}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className={cn("h-px", getStatusAccent(state.resultClass))} />
        </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-3">
        {state.errors.length > 0 ? (
          <Alert id="errors" variant="destructive" className="mb-3 flex flex-col gap-1">
            {state.errors.map((error) => (
              <AlertDescription className="text-xs" key={error}>
                {error}
              </AlertDescription>
            ))}
          </Alert>
        ) : null}

        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-3">
          <TabsList className="w-full justify-start">
            {hasPendingInputs ? (
              <TabsTrigger value="inputs" className="relative text-xs">
                Inputs
                <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning-badge px-1 text-[10px] font-medium text-warning">
                  {state.pendingInputs.length}
                </span>
              </TabsTrigger>
            ) : null}
            {hasPipelineStages ? (
              <TabsTrigger value="pipeline" className="text-xs">
                Pipeline
                {state.pipelineStagesLoading ? (
                  <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                ) : null}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="console" className="text-xs">Console</TabsTrigger>
            <TabsTrigger value="insights" className="text-xs">
              {state.resultClass === "failure" || state.resultClass === "unstable"
                ? "Analysis"
                : "Summary"}
            </TabsTrigger>
          </TabsList>

          {hasPendingInputs ? (
            <TabsContent value="inputs" className="space-y-2">
              <PendingInputsSection
                pendingInputs={state.pendingInputs}
                onApprove={(inputId) => postMessage({ type: "approveInput", inputId })}
                onReject={(inputId) => postMessage({ type: "rejectInput", inputId })}
              />
            </TabsContent>
          ) : null}

          {hasPipelineStages ? (
            <TabsContent value="pipeline" className="space-y-2" forceMount>
              <PipelineStagesSection
                stages={state.pipelineStages}
                loading={state.pipelineStagesLoading}
              />
            </TabsContent>
          ) : null}

          <TabsContent value="console" className="space-y-2" forceMount>
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

          <TabsContent value="insights" className="space-y-3" forceMount>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Scroll to top"
                className="fixed bottom-4 right-4 z-50 rounded-full shadow-widget h-8 w-8"
                onClick={scrollToTop}
                size="icon"
                variant="secondary"
              >
                <ArrowUpIcon className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Scroll to top</TooltipContent>
          </Tooltip>
        ) : null}

        <Toaster />
      </div>
    </TooltipProvider>
  );
}
