import * as React from "react";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import type { BuildCompareViewModel } from "../shared/BuildCompareContracts";
import { BuildCompareBuildPair } from "./components/buildCompare/BuildCompareBuildPair";
import { BuildCompareHeader } from "./components/buildCompare/BuildCompareHeader";
import { ChangesetsSection } from "./components/buildCompare/ChangesetsSection";
import { ConsoleDivergenceSection } from "./components/buildCompare/ConsoleDivergenceSection";
import { ParameterDiffSection } from "./components/buildCompare/ParameterDiffSection";
import { StageTimingSection } from "./components/buildCompare/StageTimingSection";
import { TestDiffSection } from "./components/buildCompare/TestDiffSection";
import { useBuildCompareMessages } from "./hooks/useBuildCompareMessages";
import { buildCompareReducer } from "./state/buildCompareState";

const { useReducer } = React;

export function BuildCompareApp({ initialState }: { initialState: BuildCompareViewModel }) {
  const [state, dispatch] = useReducer(buildCompareReducer, initialState);
  useBuildCompareMessages(dispatch);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BuildCompareHeader displayName={state.target.displayName} />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4">
        <PanelErrorList errors={state.errors} variant="card" />
        <BuildCompareBuildPair baseline={state.baseline} target={state.target} />
        <TestDiffSection section={state.tests} />
        <ParameterDiffSection section={state.parameters} />
        <ChangesetsSection section={state.changesets} />
        <StageTimingSection section={state.stages} />
        <ConsoleDivergenceSection section={state.console} />
      </main>
    </div>
  );
}
