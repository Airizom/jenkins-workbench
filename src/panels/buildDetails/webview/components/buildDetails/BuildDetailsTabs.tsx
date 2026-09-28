import type * as React from "react";
import { TabCountBadge } from "../../../../shared/webview/components/TabCountBadge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "../../../../shared/webview/components/ui/tabs";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  GaugeIcon,
  TerminalIcon,
  TestTubeIcon,
  WorkflowIcon
} from "../../../../shared/webview/icons";
import type {
  ArtifactAction,
  BuildDetailsCoverageStateViewModel,
  BuildDiagnosticsViewModel,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel,
  BuildTestCaseViewModel,
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel,
  PendingInputViewModel,
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import type { BuildDetailsTab } from "../../hooks/useBuildDetailsTabs";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import type { PendingInputProcessingAction } from "../../state/buildDetailsState";
import { resolveBuildDetailsSelectedTab } from "./buildDetailsTabsModel";
import { ConsoleOutputSection } from "./ConsoleOutputSection";
import { OverviewTab } from "./overview/OverviewTab";
import { PendingInputsSection } from "./PendingInputsSection";
import { PipelineSection } from "./PipelineSection";
import { TestResultsSection } from "./TestResultsSection";

function PipelineTabStatus({
  failedCount,
  loading
}: {
  failedCount: number;
  loading: boolean;
}): React.JSX.Element | null {
  if (failedCount > 0) {
    return (
      <TabStatusCount
        count={failedCount}
        tone="failure"
        description={pluralize(failedCount, "failed stage", "failed stages")}
      />
    );
  }
  if (loading) {
    return (
      <span className="inline-flex items-center">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
        />
        <span className="sr-only">(Loading)</span>
      </span>
    );
  }
  return null;
}

/** Visible count badge with a screen-reader phrase so "Tests 2" reads as "2 failed tests". */
function TabStatusCount({
  count,
  tone,
  description
}: {
  count: number;
  tone: "warning" | "failure";
  description: string;
}): React.JSX.Element {
  return (
    <>
      <span aria-hidden="true" className="inline-flex">
        <TabCountBadge count={count} tone={tone} />
      </span>
      <span className="sr-only">({description})</span>
    </>
  );
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function TestsTabStatus({
  summary
}: {
  summary: BuildTestsSummaryViewModel;
}): React.JSX.Element | null {
  if (summary.failedCount > 0) {
    return (
      <TabStatusCount
        count={summary.failedCount}
        tone="failure"
        description={pluralize(summary.failedCount, "failed test", "failed tests")}
      />
    );
  }
  if (summary.hasAnyResults) {
    return (
      <>
        <CheckCircleIcon className="h-3 w-3 text-success" />
        <span className="sr-only">(all passed)</span>
      </>
    );
  }
  return null;
}

type BuildDetailsTabsProps = {
  selectedTab: BuildDetailsTab;
  onTabChange: (tab: BuildDetailsTab) => void;
  hasPendingInputs: boolean;
  hasPipelineStages: boolean;
  hasTests: boolean;
  pendingInputs: PendingInputViewModel[];
  processingInputActions?: Record<string, PendingInputProcessingAction>;
  pipelineStages: PipelineStageViewModel[];
  pipelineNodeLog: PipelineNodeLogViewModel;
  pipelineNodeLogHtmlModel?: ConsoleHtmlModel;
  pipelineStagesLoading: boolean;
  stripFailedCount: number;
  buildUrl?: string;
  resultClass: string;
  testsSummary: BuildTestsSummaryViewModel;
  testResults: BuildTestResultsViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  insights: BuildFailureInsightsViewModel;
  diagnostics: BuildDiagnosticsViewModel;
  consoleText: string;
  consoleHtmlModel?: ConsoleHtmlModel;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  followLog: boolean;
  onApproveInput: (inputId: string) => void;
  onRejectInput: (inputId: string) => void;
  onRestartStage: (stageName: string) => void;
  onSelectPipelineLog: (target: PipelineLogTargetViewModel) => void;
  onClearPipelineLog: () => void;
  onExportPipelineLog: () => void;
  onToggleFollowLog: (value: boolean) => void;
  onExportLogs: () => void;
  onOpenExternal: (url: string) => void;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
  onReloadTestResults: () => void;
  onOpenTestSource: (testCase: BuildTestCaseViewModel) => void;
  onOpenDiagnosticSource: (targetId: string) => void;
  onShowDiagnosticProblems: () => void;
  onConfigureBuildDiagnostics: () => void;
};
export function BuildDetailsTabs({
  selectedTab,
  onTabChange,
  hasPendingInputs,
  hasPipelineStages,
  hasTests,
  pendingInputs,
  processingInputActions,
  pipelineStages,
  pipelineNodeLog,
  pipelineNodeLogHtmlModel,
  pipelineStagesLoading,
  stripFailedCount,
  buildUrl,
  resultClass,
  testsSummary,
  testResults,
  coverageState,
  insights,
  diagnostics,
  consoleText,
  consoleHtmlModel,
  consoleTruncated,
  consoleMaxChars,
  consoleError,
  followLog,
  onApproveInput,
  onRejectInput,
  onRestartStage,
  onSelectPipelineLog,
  onClearPipelineLog,
  onExportPipelineLog,
  onToggleFollowLog,
  onExportLogs,
  onOpenExternal,
  onArtifactAction,
  onReloadTestResults,
  onOpenTestSource,
  onOpenDiagnosticSource,
  onShowDiagnosticProblems,
  onConfigureBuildDiagnostics
}: BuildDetailsTabsProps): React.JSX.Element {
  const activeTab = resolveBuildDetailsSelectedTab(selectedTab, {
    hasPendingInputs,
    hasPipelineStages,
    hasTests
  });

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as BuildDetailsTab)}
      className="space-y-3"
    >
      {/* Docked below the hero so tab switching stays reachable while reading a
       * long console log or test list. */}
      <div className="build-details-tabs-bar">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview" className="text-xs">
            <GaugeIcon className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          {hasPendingInputs ? (
            <TabsTrigger value="inputs" className="text-xs">
              <AlertCircleIcon className="h-3.5 w-3.5" />
              Inputs
              <TabStatusCount
                count={pendingInputs.length}
                tone="warning"
                description={pluralize(pendingInputs.length, "pending input", "pending inputs")}
              />
            </TabsTrigger>
          ) : null}
          {hasPipelineStages ? (
            <TabsTrigger value="pipeline" className="text-xs">
              <WorkflowIcon className="h-3.5 w-3.5" />
              Pipeline
              <PipelineTabStatus failedCount={stripFailedCount} loading={pipelineStagesLoading} />
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="console" className="text-xs">
            <TerminalIcon className="h-3.5 w-3.5" />
            Console
          </TabsTrigger>
          {hasTests ? (
            <TabsTrigger value="tests" className="text-xs">
              <TestTubeIcon className="h-3.5 w-3.5" />
              Tests
              <TestsTabStatus summary={testsSummary} />
            </TabsTrigger>
          ) : null}
        </TabsList>
      </div>

      <TabsContent value="overview" className="space-y-3">
        <OverviewTab
          resultClass={resultClass}
          testsSummary={testsSummary}
          coverageState={coverageState}
          insights={insights}
          diagnostics={diagnostics}
          hasTests={hasTests}
          onNavigateTab={onTabChange}
          onArtifactAction={onArtifactAction}
          onOpenDiagnosticSource={onOpenDiagnosticSource}
          onShowDiagnosticProblems={onShowDiagnosticProblems}
          onConfigureBuildDiagnostics={onConfigureBuildDiagnostics}
        />
      </TabsContent>

      {hasPendingInputs ? (
        <TabsContent value="inputs" className="space-y-2">
          <PendingInputsSection
            pendingInputs={pendingInputs}
            processingActions={processingInputActions}
            onApprove={onApproveInput}
            onReject={onRejectInput}
          />
        </TabsContent>
      ) : null}

      {hasPipelineStages ? (
        <TabsContent value="pipeline" className="space-y-2" forceMount>
          <PipelineSection
            stages={pipelineStages}
            pipelineNodeLog={pipelineNodeLog}
            pipelineNodeLogHtmlModel={pipelineNodeLogHtmlModel}
            loading={pipelineStagesLoading}
            onRestartStage={onRestartStage}
            onSelectPipelineLog={onSelectPipelineLog}
            onClearPipelineLog={onClearPipelineLog}
            onExportPipelineLog={onExportPipelineLog}
            onOpenExternal={onOpenExternal}
            isRunning={resultClass === "running"}
            isActive={activeTab === "pipeline"}
          />
        </TabsContent>
      ) : null}

      <TabsContent value="console" className="space-y-2" forceMount>
        <ConsoleOutputSection
          consoleText={consoleText}
          consoleHtmlModel={consoleHtmlModel}
          consoleTruncated={consoleTruncated}
          consoleMaxChars={consoleMaxChars}
          consoleError={consoleError}
          followLog={followLog}
          isRunning={resultClass === "running"}
          isActive={activeTab === "console"}
          onToggleFollowLog={onToggleFollowLog}
          onExportLogs={onExportLogs}
          onOpenExternal={onOpenExternal}
          sourceReferences={diagnostics.consoleReferences}
          onOpenDiagnosticSource={onOpenDiagnosticSource}
        />
      </TabsContent>

      {hasTests ? (
        <TabsContent value="tests" className="space-y-3" forceMount>
          <TestResultsSection
            buildUrl={buildUrl}
            summary={testsSummary}
            results={testResults}
            coverageState={coverageState}
            onReloadWithLogs={onReloadTestResults}
            onOpenSource={onOpenTestSource}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
