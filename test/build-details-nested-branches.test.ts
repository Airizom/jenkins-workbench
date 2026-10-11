import assert from "node:assert/strict";
import { type ComponentProps, createElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { StageNode } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/StageNode";
import { Accordion } from "../src/panels/shared/webview/components/ui/accordion";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

const { logActions } = vi.hoisted(() => ({ logActions: new Map<string, () => void>() }));

// Server rendering cannot click disclosures; render every branch in its expanded state.
vi.mock("../src/panels/shared/webview/components/ui/collapsible", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/panels/shared/webview/components/ui/collapsible")>();
  return {
    ...actual,
    Collapsible: (props: ComponentProps<typeof actual.Collapsible>) =>
      createElement(actual.Collapsible, { ...props, open: true })
  };
});

// Keep the real button markup and capture the action that a click would invoke.
vi.mock("../src/panels/shared/webview/components/ui/button", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/panels/shared/webview/components/ui/button")>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      const label = props["aria-label"];
      if (label && props.onClick) {
        logActions.set(label, () => props.onClick?.({} as MouseEvent<HTMLButtonElement>));
      }
      return createElement(actual.Button, props);
    }
  };
});

function branch(
  key: string,
  stepsAll: PipelineStageStepViewModel[] = [],
  parallelBranches: PipelineStageViewModel[] = []
): PipelineStageViewModel {
  return {
    key,
    name: key,
    statusLabel: "Failed",
    statusClass: "failure",
    durationLabel: "1s",
    canRestartFromStage: false,
    canOpenLog: false,
    hasSteps: stepsAll.length > 0 || parallelBranches.some((child) => child.hasSteps),
    stepsAll,
    stepsFailedOnly: stepsAll.filter((step) => step.statusClass === "failure"),
    parallelBranches
  };
}

describe("nested pipeline branches", () => {
  beforeEach(() => {
    // Tooltip click handlers clear their browser timer after selecting the log.
    vi.stubGlobal("window", { clearTimeout });
    logActions.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])("renders expanded descendants with showAll=%s", (showAll) => {
    const logTarget: PipelineLogTargetViewModel = {
      key: "failed-step",
      kind: "step",
      name: "Failed leaf step",
      nodeId: "42"
    };
    const failedStep: PipelineStageStepViewModel = {
      key: "failed-step",
      name: "Failed leaf step",
      statusClass: "failure",
      statusLabel: "Failed",
      durationLabel: "1s",
      canOpenLog: true,
      logTarget
    };
    const passedStep: PipelineStageStepViewModel = {
      ...failedStep,
      key: "passed-step",
      name: "Passed leaf step",
      statusClass: "success",
      statusLabel: "Success",
      canOpenLog: false,
      logTarget: undefined
    };
    const stage = branch(
      "Stage",
      [],
      [branch("Outer branch", [], [branch("Nested branch", [failedStep, passedStep])])]
    );
    const onSelectPipelineLog = vi.fn();
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          Accordion,
          { type: "multiple", value: [stage.key] },
          createElement(StageNode, {
            stageId: stage.key,
            stage,
            showAll,
            isLast: true,
            onRestartStage: () => undefined,
            onSelectPipelineLog,
            onShowAllChange: () => undefined
          })
        )
      )
    );

    assert.match(html, />Outer branch</);
    assert.match(html, />Nested branch</);
    assert.match(html, />Failed leaf step</);
    assert.equal(html.includes(">Passed leaf step<"), showAll);
    assert.equal(html.match(/>Failed steps only</g)?.length, 1);
    assert.match(html, new RegExp(`aria-pressed="${!showAll}"`));
    assert.doesNotMatch(html, /No (failed )?steps/);
    const openLog = logActions.get("Open log for Failed leaf step");
    assert.ok(openLog, "the nested leaf exposes its log action");
    openLog();
    expect(onSelectPipelineLog).toHaveBeenCalledExactlyOnceWith(logTarget);
  });
});
