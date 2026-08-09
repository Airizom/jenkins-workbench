import type * as React from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { TerminalIcon, TestTubeIcon, WorkflowIcon } from "../../../../../shared/webview/icons";
import { isAnalysisBuildResult } from "../../../../../shared/webview/lib/statusStyles";
import type {
  ArtifactAction,
  BuildDetailsCoverageStateViewModel,
  BuildDiagnosticsViewModel,
  BuildFailureArtifact,
  BuildFailureInsightsViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { BuildDetailsTab } from "../../../hooks/useBuildDetailsTabs";
import { BuildFailureInsightsSection } from "../BuildFailureInsightsSection";
import { CoverageGlanceCard } from "./CoverageGlanceCard";
import { TestPassDonutCard } from "./TestPassDonutCard";

type OverviewTabProps = {
  resultClass: string;
  testsSummary: BuildTestsSummaryViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  insights: BuildFailureInsightsViewModel;
  diagnostics: BuildDiagnosticsViewModel;
  hasPipelineStages: boolean;
  hasTests: boolean;
  onNavigateTab: (tab: BuildDetailsTab) => void;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
  onOpenDiagnosticSource: (targetId: string) => void;
  onShowDiagnosticProblems: () => void;
  onConfigureBuildDiagnostics: () => void;
};
export function OverviewTab({
  resultClass,
  testsSummary,
  coverageState,
  insights,
  diagnostics,
  hasPipelineStages,
  hasTests,
  onNavigateTab,
  onArtifactAction,
  onOpenDiagnosticSource,
  onShowDiagnosticProblems,
  onConfigureBuildDiagnostics
}: OverviewTabProps): React.JSX.Element {
  const showTestsCard = hasTests && testsSummary.hasAnyResults;
  const insightsTitle = isAnalysisBuildResult(resultClass) ? "Failure Analysis" : "Build Summary";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Jump to</span>
        {hasPipelineStages ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onNavigateTab("pipeline")}
          >
            <WorkflowIcon className="h-3.5 w-3.5" />
            Pipeline
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-7 px-2 text-xs text-muted-foreground"
          onClick={() => onNavigateTab("console")}
        >
          <TerminalIcon className="h-3.5 w-3.5" />
          Console
        </Button>
        {hasTests ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onNavigateTab("tests")}
          >
            <TestTubeIcon className="h-3.5 w-3.5" />
            Tests
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {showTestsCard ? (
          <TestPassDonutCard summary={testsSummary} onShowTests={() => onNavigateTab("tests")} />
        ) : null}
        <CoverageGlanceCard
          coverageState={coverageState}
          onShowTests={hasTests ? () => onNavigateTab("tests") : undefined}
        />
      </div>
      <section aria-label={insightsTitle} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {insightsTitle}
        </h2>
        <BuildFailureInsightsSection
          insights={insights}
          diagnostics={diagnostics}
          onArtifactAction={onArtifactAction}
          onOpenDiagnosticSource={onOpenDiagnosticSource}
          onShowDiagnosticProblems={onShowDiagnosticProblems}
          onConfigureBuildDiagnostics={onConfigureBuildDiagnostics}
        />
      </section>
    </div>
  );
}
