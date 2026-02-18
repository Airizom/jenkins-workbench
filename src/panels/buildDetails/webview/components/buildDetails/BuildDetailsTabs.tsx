import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import type {
  ArtifactAction,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel,
  PipelineStageViewModel,
  PendingInputViewModel
} from "../../../shared/BuildDetailsContracts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../shared/webview/components/ui/tabs";
import { BuildFailureInsightsSection } from "./BuildFailureInsightsSection";
import { BuildSummaryCard } from "./BuildSummaryCard";
import { ConsoleOutputSection } from "./ConsoleOutputSection";
import { PendingInputsSection } from "./PendingInputsSection";
import { PipelineStagesSection } from "./PipelineStagesSection";
import type { BuildDetailsTab } from "../../hooks/useBuildDetailsTabs";

type BuildDetailsTabsProps = {
  selectedTab: BuildDetailsTab;
  onTabChange: (tab: BuildDetailsTab) => void;
  hasPendingInputs: boolean;
  hasPipelineStages: boolean;
  pendingInputs: PendingInputViewModel[];
  pipelineStages: PipelineStageViewModel[];
  pipelineStagesLoading: boolean;
  displayName: string;
  resultClass: string;
  resultLabel: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
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
  onToggleFollowLog: (value: boolean) => void;
  onExportLogs: () => void;
  onOpenExternal: (url: string) => void;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
};

export function BuildDetailsTabs({
  selectedTab,
  onTabChange,
  hasPendingInputs,
  hasPipelineStages,
  pendingInputs,
  pipelineStages,
  pipelineStagesLoading,
  displayName,
  resultClass,
  resultLabel,
  durationLabel,
  timestampLabel,
  culpritsLabel,
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
  onToggleFollowLog,
  onExportLogs,
  onOpenExternal,
  onArtifactAction
}: BuildDetailsTabsProps): JSX.Element {
  return (
    <Tabs value={selectedTab} onValueChange={(value) => onTabChange(value as BuildDetailsTab)} className="space-y-3">
      <TabsList className="w-full justify-start">
        {hasPendingInputs ? (
          <TabsTrigger value="inputs" className="relative text-xs">
            Inputs
            <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning-badge px-1 text-[10px] font-medium text-warning">
              {pendingInputs.length}
            </span>
          </TabsTrigger>
        ) : null}
        {hasPipelineStages ? (
          <TabsTrigger value="pipeline" className="text-xs">
            Pipeline
            {pipelineStagesLoading ? (
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            ) : null}
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="console" className="text-xs">
          Console
        </TabsTrigger>
        <TabsTrigger value="insights" className="text-xs">
          {resultClass === "failure" || resultClass === "unstable" ? "Analysis" : "Summary"}
        </TabsTrigger>
      </TabsList>

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
          <PipelineStagesSection
            stages={pipelineStages}
            loading={pipelineStagesLoading}
            onRestartStage={onRestartStage}
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

      <TabsContent value="insights" className="space-y-3" forceMount>
        <BuildSummaryCard
          displayName={displayName}
          resultLabel={resultLabel}
          resultClass={resultClass}
          durationLabel={durationLabel}
          timestampLabel={timestampLabel}
          culpritsLabel={culpritsLabel}
        />
        <BuildFailureInsightsSection
          insights={insights}
          resultClass={resultClass}
          onArtifactAction={onArtifactAction}
        />
      </TabsContent>
    </Tabs>
  );
}
