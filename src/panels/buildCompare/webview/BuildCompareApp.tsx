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
  const sections = [
    {
      id: "compare-section-tests",
      label: "Tests",
      section: state.tests,
      content: <TestDiffSection section={state.tests} />
    },
    {
      id: "compare-section-parameters",
      label: "Parameters",
      section: state.parameters,
      content: <ParameterDiffSection section={state.parameters} />
    },
    {
      id: "compare-section-changesets",
      label: "Changes",
      section: state.changesets,
      content: <ChangesetsSection section={state.changesets} />
    },
    {
      id: "compare-section-stages",
      label: "Stages",
      section: state.stages,
      content: <StageTimingSection section={state.stages} />
    },
    {
      id: "compare-section-console",
      label: "Console",
      section: state.console,
      content: <ConsoleDivergenceSection section={state.console} />
    }
  ];
  const sectionErrors = sections.flatMap(({ section }) =>
    section.status === "error" ? [section.detail ?? section.summaryLabel] : []
  );
  const isLoading = sections.some(({ section }) => section.status === "loading");

  const navItems: CompareSectionNavItem[] = sections.map(({ id, label, section }) => ({
    id,
    label,
    status: section.status
  }));

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
        {sections.map(({ id, content }) => (
          <div key={id} id={id} className="scroll-mt-20">
            {content}
          </div>
        ))}
      </main>
      <Toaster />
    </div>
  );
}
