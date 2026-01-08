import * as React from "react";
import type { BuildDetailsViewModel } from "../shared/BuildDetailsContracts";
import { BuildFailureInsightsSection } from "./components/buildDetails/BuildFailureInsightsSection";
import { BuildSummaryCard } from "./components/buildDetails/BuildSummaryCard";
import { ConsoleOutputSection } from "./components/buildDetails/ConsoleOutputSection";
import { PendingInputsSection } from "./components/buildDetails/PendingInputsSection";
import { PipelineStagesSection } from "./components/buildDetails/PipelineStagesSection";
import { Alert, AlertDescription } from "./components/ui/alert";
import { useBuildDetailsInteractions } from "./hooks/useBuildDetailsInteractions";
import { useBuildDetailsMessages } from "./hooks/useBuildDetailsMessages";
import { buildDetailsReducer, buildInitialState, DEFAULT_INSIGHTS } from "./state/buildDetailsState";

const { useReducer } = React;

export function BuildDetailsApp({ initialState }: { initialState: BuildDetailsViewModel }) {
  const [state, dispatch] = useReducer(buildDetailsReducer, initialState, buildInitialState);
  const postMessage = useBuildDetailsInteractions();
  useBuildDetailsMessages(dispatch);

  const insights = state.insights ?? DEFAULT_INSIGHTS;

  return (
    <div className="min-h-screen px-6 py-6 flex flex-col gap-6">
      {state.errors.length > 0 ? (
        <Alert id="errors" variant="destructive" className="flex flex-col gap-1.5">
          {state.errors.map((error) => (
            <AlertDescription className="text-[13px]" key={error}>
              {error}
            </AlertDescription>
          ))}
        </Alert>
      ) : null}

      <BuildSummaryCard
        displayName={state.displayName}
        resultLabel={state.resultLabel}
        resultClass={state.resultClass}
        durationLabel={state.durationLabel}
        timestampLabel={state.timestampLabel}
        culpritsLabel={state.culpritsLabel}
      />

      <PendingInputsSection
        pendingInputs={state.pendingInputs}
        onApprove={(inputId) => postMessage({ type: "approveInput", inputId })}
        onReject={(inputId) => postMessage({ type: "rejectInput", inputId })}
      />

      <PipelineStagesSection stages={state.pipelineStages} />

      <BuildFailureInsightsSection
        insights={insights}
        onArtifactAction={(action, artifact) =>
          postMessage({
            type: "artifactAction",
            action,
            relativePath: artifact.relativePath,
            fileName: artifact.fileName ?? undefined
          })
        }
      />

      <ConsoleOutputSection
        consoleText={state.consoleText}
        consoleHtmlModel={state.consoleHtmlModel}
        consoleTruncated={state.consoleTruncated}
        consoleMaxChars={state.consoleMaxChars}
        consoleError={state.consoleError}
        followLog={state.followLog}
        onToggleFollowLog={(value) => {
          dispatch({ type: "setFollowLog", value });
          postMessage({ type: "toggleFollowLog", value });
        }}
        onExportLogs={() => postMessage({ type: "exportConsole" })}
        onOpenExternal={(url) => postMessage({ type: "openExternal", url })}
      />
    </div>
  );
}
