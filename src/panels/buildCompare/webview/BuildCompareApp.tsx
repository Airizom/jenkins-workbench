import * as React from "react";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import { Progress } from "../../shared/webview/components/ui/progress";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { usePanelPostMessage } from "../../shared/webview/hooks/usePanelPostMessage";
import { toast } from "../../shared/webview/hooks/useToast";
import type { BuildCompareViewModel } from "../shared/BuildCompareContracts";
import type { BuildCompareIncomingMessage } from "../shared/BuildComparePanelMessages";
import { BuildCompareBuildPair } from "./components/buildCompare/BuildCompareBuildPair";
import { BuildCompareHeader } from "./components/buildCompare/BuildCompareHeader";
import { ChangesetsSection } from "./components/buildCompare/ChangesetsSection";
import type { CompareSectionNavItem } from "./components/buildCompare/CompareSectionNav";
import { CompareSectionNav } from "./components/buildCompare/CompareSectionNav";
import { ConsoleDivergenceSection } from "./components/buildCompare/ConsoleDivergenceSection";
import { ParameterDiffSection } from "./components/buildCompare/ParameterDiffSection";
import { StageTimingSection } from "./components/buildCompare/StageTimingSection";
import { TestDiffSection } from "./components/buildCompare/TestDiffSection";
import { useBuildCompareMessages } from "./hooks/useBuildCompareMessages";
import { buildCompareReducer } from "./state/buildCompareState";

const { useEffect, useReducer } = React;

const SECTION_IDS = {
  tests: "compare-section-tests",
  parameters: "compare-section-parameters",
  changesets: "compare-section-changesets",
  stages: "compare-section-stages",
  console: "compare-section-console"
} as const;

export function BuildCompareApp({ initialState }: { initialState: BuildCompareViewModel }) {
  const [state, dispatch] = useReducer(buildCompareReducer, initialState);
  const postMessage = usePanelPostMessage<BuildCompareIncomingMessage>();
  useBuildCompareMessages(dispatch);

  // Declared after useBuildCompareMessages so the message listener is attached
  // before the host reacts to the ready handshake by re-sending sections.
  useEffect(() => {
    postMessage({ type: "buildCompareReady" });
  }, [postMessage]);

  const handleRetry = () => {
    postMessage({ type: "refreshBuildCompare" });
    toast({ title: "Refreshing comparison" });
  };
  const sectionErrors = [
    state.tests,
    state.parameters,
    state.changesets,
    state.stages,
    state.console
  ].flatMap((section) =>
    section.status === "error" ? [section.detail ?? section.summaryLabel] : []
  );
  const isLoading = state.console.status === "loading";

  const navItems: CompareSectionNavItem[] = [
    { id: SECTION_IDS.tests, label: "Tests", status: state.tests.status },
    { id: SECTION_IDS.parameters, label: "Parameters", status: state.parameters.status },
    { id: SECTION_IDS.changesets, label: "Changes", status: state.changesets.status },
    { id: SECTION_IDS.stages, label: "Stages", status: state.stages.status },
    { id: SECTION_IDS.console, label: "Console", status: state.console.status }
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {isLoading ? (
        <div className="fixed inset-x-0 top-0 z-50">
          <Progress indeterminate className="h-px rounded-none" />
        </div>
      ) : null}
      <BuildCompareHeader
        baselineDisplayName={state.baseline.displayName}
        targetDisplayName={state.target.displayName}
        loading={isLoading}
        onRefresh={handleRetry}
      />

      <main
        className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4"
        aria-busy={isLoading}
      >
        <PanelErrorList
          errors={[...state.errors, ...sectionErrors]}
          title="Comparison errors"
          onRetry={handleRetry}
        />
        <BuildCompareBuildPair baseline={state.baseline} target={state.target} />
        <CompareSectionNav items={navItems} />
        <div id={SECTION_IDS.tests} className="scroll-mt-20">
          <TestDiffSection section={state.tests} />
        </div>
        <div id={SECTION_IDS.parameters} className="scroll-mt-20">
          <ParameterDiffSection section={state.parameters} />
        </div>
        <div id={SECTION_IDS.changesets} className="scroll-mt-20">
          <ChangesetsSection section={state.changesets} />
        </div>
        <div id={SECTION_IDS.stages} className="scroll-mt-20">
          <StageTimingSection section={state.stages} />
        </div>
        <div id={SECTION_IDS.console} className="scroll-mt-20">
          <ConsoleDivergenceSection section={state.console} />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
