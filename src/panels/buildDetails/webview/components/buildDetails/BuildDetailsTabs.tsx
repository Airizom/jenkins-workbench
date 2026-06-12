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
import { ConsoleOutputSection } from "./ConsoleOutputSection";
import { PendingInputsSection } from "./PendingInputsSection";
import { PipelineSection } from "./PipelineSection";
import { TestResultsSection } from "./TestResultsSection";
import { resolveBuildDetailsSelectedTab } from "./buildDetailsTabsModel";
import { OverviewTab } from "./overview/OverviewTab";

function TabCountBadge({
  count,
  tone
}: {
  count: number;
  tone: "warning" | "failure";
}): JSX.Element {
  const toneClass =
    tone === "warning" ? "bg-warning-badge text-warning" : "bg-failure-soft text-failure";
  return (
    <span
      className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium ${toneClass}`}
    >
      {count}
    </span>
  );
}

function PipelineTabStatus({
  failedCount,
  loading
}: {
  failedCount: number;
  loading: boolean;
}): JSX.Element | null {
  if (failedCount > 0) {
    return <TabCountBadge count={failedCount} tone="failure" />;
  }
  if (loading) {
    return <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />;
  }
  return null;
}

function TestsTabStatus({ summary }: { summary: BuildTestsSummaryViewModel }): JSX.Element | null {
  if (summary.failedCount > 0) {
    return <TabCountBadge count={summary.failedCount} tone="failure" />;
  }
  if (summary.hasAnyResults) {
    return <CheckCircleIcon className="h-3 w-3 text-success" />;
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
  pipelineStages: PipelineStageViewModel[];
  pipelineNodeLog: PipelineNodeLogViewModel;
  pipelineNodeLogHtmlModel?: ConsoleHtmlModel;
  pipelineStagesLoading: boolean;
  stripFailedCount: number;
  displayName: string;
  buildUrl?: string;
  resultClass: string;
  resultLabel: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  testsSummary: BuildTestsSummaryViewModel;
  testResults: BuildTestResultsViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  insights: BuildFailureInsightsViewModel;
  consoleText: string;
  consoleHtmlModel?: ConsoleHtmlModel;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  followLog: boolean;
  isConsoleTabActive: boolean;
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
};
export function BuildDetailsTabs({
  selectedTab,
  onTabChange,
  hasPendingInputs,
  hasPipelineStages,
  hasTests,
  pendingInputs,
  pipelineStages,
  pipelineNodeLog,
  pipelineNodeLogHtmlModel,
  pipelineStagesLoading,
  stripFailedCount,
  displayName,
  buildUrl,
  resultClass,
  resultLabel,
  durationLabel,
  timestampLabel,
  culpritsLabel,
  testsSummary,
  testResults,
  coverageState,
  insights,
  consoleText,
  consoleHtmlModel,
  consoleTruncated,
  consoleMaxChars,
  consoleError,
  followLog,
  isConsoleTabActive,
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
  onOpenTestSource
}: BuildDetailsTabsProps): JSX.Element {
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
      <TabsList className="w-full justify-start">
        <TabsTrigger value="overview" className="gap-1.5 text-xs">
          <GaugeIcon className="h-3.5 w-3.5" />
          Overview
        </TabsTrigger>
        {hasPendingInputs ? (
          <TabsTrigger value="inputs" className="relative gap-1.5 text-xs">
            <AlertCircleIcon className="h-3.5 w-3.5" />
            Inputs
            <TabCountBadge count={pendingInputs.length} tone="warning" />
          </TabsTrigger>
        ) : null}
        {hasPipelineStages ? (
          <TabsTrigger value="pipeline" className="gap-1.5 text-xs">
            <WorkflowIcon className="h-3.5 w-3.5" />
            Pipeline
            <PipelineTabStatus failedCount={stripFailedCount} loading={pipelineStagesLoading} />
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="console" className="gap-1.5 text-xs">
          <TerminalIcon className="h-3.5 w-3.5" />
          Console
        </TabsTrigger>
        {hasTests ? (
          <TabsTrigger value="tests" className="relative gap-1.5 text-xs">
            <TestTubeIcon className="h-3.5 w-3.5" />
            Tests
            <TestsTabStatus summary={testsSummary} />
          </TabsTrigger>
        ) : null}
      </TabsList>

      <TabsContent value="overview" className="space-y-3">
        <OverviewTab
          displayName={displayName}
          resultLabel={resultLabel}
          resultClass={resultClass}
          durationLabel={durationLabel}
          timestampLabel={timestampLabel}
          culpritsLabel={culpritsLabel}
          testsSummary={testsSummary}
          coverageState={coverageState}
          insights={insights}
          hasPipelineStages={hasPipelineStages}
          hasTests={hasTests}
          onNavigateTab={onTabChange}
          onArtifactAction={onArtifactAction}
        />
      </TabsContent>

      {hasPendingInputs ? (
        <TabsContent value="inputs" className="space-y-2">
          <PendingInputsSection
            pendingInputs={pendingInputs}
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
          isActive={isConsoleTabActive}
          onToggleFollowLog={onToggleFollowLog}
          onExportLogs={onExportLogs}
          onOpenExternal={onOpenExternal}
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
