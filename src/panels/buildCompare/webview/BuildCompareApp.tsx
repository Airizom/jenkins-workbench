import * as React from "react";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import { Progress } from "../../shared/webview/components/ui/progress";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { usePanelPostMessage } from "../../shared/webview/hooks/usePanelPostMessage";
import { toast } from "../../shared/webview/hooks/useToast";
import type { BuildCompareViewModel, CompareSectionStatus } from "../shared/BuildCompareContracts";
import type { BuildCompareIncomingMessage } from "../shared/BuildComparePanelMessages";
import type { BuildCompareSectionId } from "../shared/BuildComparePanelWebviewState";
import { BuildCompareBuildPair } from "./components/buildCompare/BuildCompareBuildPair";
import { BuildCompareHeader } from "./components/buildCompare/BuildCompareHeader";
import { ChangesetsSection } from "./components/buildCompare/ChangesetsSection";
import type { CompareSectionNavItem } from "./components/buildCompare/CompareSectionNav";
import { CompareSectionNav } from "./components/buildCompare/CompareSectionNav";
import { ConsoleDivergenceSection } from "./components/buildCompare/ConsoleDivergenceSection";
import {
  COMPARE_SECTION_TITLES,
  resolveCompareSectionNavChip
} from "./components/buildCompare/compareSectionNavModel";
import { ParameterDiffSection } from "./components/buildCompare/ParameterDiffSection";
import { StageTimingSection } from "./components/buildCompare/StageTimingSection";
import { TestDiffSection } from "./components/buildCompare/TestDiffSection";
import { useBuildCompareMessages } from "./hooks/useBuildCompareMessages";
import { useCollapsedSections } from "./hooks/useCollapsedSections";
import {
  type BuildCompareBusyAction,
  buildCompareReducer,
  createBuildCompareState
} from "./state/buildCompareState";

const { useEffect, useReducer } = React;

const SECTION_ORDER: BuildCompareSectionId[] = [
  "tests",
  "parameters",
  "changesets",
  "stages",
  "console"
];

const ACTION_MESSAGES: Record<
  BuildCompareBusyAction,
  { message: BuildCompareIncomingMessage; failureTitle: string; successTitle: string }
> = {
  refresh: {
    message: { type: "refreshBuildCompare" },
    failureTitle: "Refresh failed",
    successTitle: "Comparison refreshed"
  },
  swap: {
    message: { type: "swapBuilds" },
    failureTitle: "Swap failed",
    successTitle: "Swapped baseline and target"
  }
};

/** Sections with nothing to show start collapsed; their summary line says why. */
const QUIET_STATUSES: ReadonlySet<CompareSectionStatus> = new Set([
  "empty",
  "unavailable",
  "identical"
]);

function sectionAnchorId(id: BuildCompareSectionId): string {
  return `compare-section-${id}`;
}

export function BuildCompareApp({ initialState }: { initialState: BuildCompareViewModel }) {
  const [state, dispatch] = useReducer(buildCompareReducer, initialState, createBuildCompareState);
  const { model, busyAction, actionError, completedAction } = state;
  const postMessage = usePanelPostMessage<BuildCompareIncomingMessage>();
  const { isOpen, setOpen } = useCollapsedSections();
  useBuildCompareMessages(dispatch);

  // Declared after useBuildCompareMessages so the message listener is attached
  // before the host reacts to the ready handshake by re-sending sections.
  useEffect(() => {
    postMessage({ type: "buildCompareReady" });
  }, [postMessage]);

  useEffect(() => {
    if (completedAction) {
      toast({ title: ACTION_MESSAGES[completedAction.action].successTitle });
    }
  }, [completedAction]);

  const runAction = (action: BuildCompareBusyAction) => {
    dispatch({ type: "startAction", action });
    postMessage(ACTION_MESSAGES[action].message);
  };

  const disclosure = (id: BuildCompareSectionId) => ({
    open: isOpen(id, !QUIET_STATUSES.has(model[id].status)),
    onOpenChange: (open: boolean) => setOpen(id, open)
  });

  const sectionContent: Record<BuildCompareSectionId, React.ReactNode> = {
    tests: <TestDiffSection section={model.tests} {...disclosure("tests")} />,
    parameters: <ParameterDiffSection section={model.parameters} {...disclosure("parameters")} />,
    changesets: <ChangesetsSection section={model.changesets} {...disclosure("changesets")} />,
    stages: <StageTimingSection section={model.stages} {...disclosure("stages")} />,
    console: (
      <ConsoleDivergenceSection
        section={model.console}
        baseline={model.baseline}
        target={model.target}
        {...disclosure("console")}
      />
    )
  };

  // Each failed section explains itself in place; this list only names them.
  const sectionErrors = SECTION_ORDER.flatMap((id) => {
    const section = model[id];
    return section.status === "error"
      ? [`${COMPARE_SECTION_TITLES[id]}: ${section.summaryLabel}`]
      : [];
  });
  const isLoading = SECTION_ORDER.some((id) => model[id].status === "loading");
  // The console scan runs after the rest of the comparison and can take a while;
  // it must not lock Refresh or Swap (both restart it anyway).
  const actionsBusy =
    busyAction !== undefined ||
    SECTION_ORDER.some((id) => id !== "console" && model[id].status === "loading");
  const busy = isLoading || busyAction !== undefined;

  const navItems: CompareSectionNavItem[] = SECTION_ORDER.map((id) => ({
    id: sectionAnchorId(id),
    label: COMPARE_SECTION_TITLES[id],
    chip: resolveCompareSectionNavChip(id, model)
  }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {busy ? (
        <div className="fixed inset-x-0 top-0 z-50">
          <Progress indeterminate className="h-px rounded-none" />
        </div>
      ) : null}
      <BuildCompareHeader
        baseline={model.baseline}
        target={model.target}
        busy={actionsBusy}
        busyAction={busyAction}
        onRefresh={() => runAction("refresh")}
        onSwap={() => runAction("swap")}
      />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4" aria-busy={busy}>
        {actionError ? (
          <PanelErrorList
            errors={[actionError.message]}
            title={`${ACTION_MESSAGES[actionError.action].failureTitle}. Showing the previous comparison.`}
            className="flex flex-col gap-1"
            onRetry={actionsBusy ? undefined : () => runAction(actionError.action)}
          />
        ) : null}
        <PanelErrorList
          errors={[...model.errors, ...sectionErrors]}
          title="Comparison errors"
          className="flex flex-col gap-1"
          onRetry={actionsBusy ? undefined : () => runAction("refresh")}
        />
        <BuildCompareBuildPair baseline={model.baseline} target={model.target} />
        <CompareSectionNav items={navItems} />
        {SECTION_ORDER.map((id) => (
          <div key={id} id={sectionAnchorId(id)} className="scroll-mt-20">
            {sectionContent[id]}
          </div>
        ))}
      </main>
      <Toaster />
    </div>
  );
}
