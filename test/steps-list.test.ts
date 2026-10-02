import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { BranchCard } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/BranchCard";
import { StepsList } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/StepsList";
import { StepsVisibilityToggle } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/StepsVisibilityToggle";
import {
  defaultShowAllSteps,
  formatCount
} from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/pipelineStagesUtils";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

function makeStep(overrides: Partial<PipelineStageStepViewModel> = {}): PipelineStageStepViewModel {
  return {
    key: "step-1",
    name: "Checkout",
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "3s",
    canOpenLog: false,
    ...overrides
  };
}

describe("StepsList", () => {
  it("renders named steps with regular padding and an accessible log action", () => {
    const logTarget: PipelineLogTargetViewModel = {
      key: "step-1",
      kind: "step",
      name: "Checkout",
      nodeId: "12"
    };
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(StepsList, {
          steps: [makeStep({ logTarget })],
          onSelectPipelineLog: () => undefined
        })
      )
    );

    assert.match(html, />Checkout</);
    assert.match(html, />3s</);
    assert.match(html, /aria-label="Open log for Checkout"/);
    assert.match(html, /px-2\.5 py-1\.5/);
  });

  it("renders fallback labels with compact padding", () => {
    const logTarget: PipelineLogTargetViewModel = {
      key: "step-1",
      kind: "step",
      name: "",
      nodeId: "12"
    };
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(StepsList, {
          steps: [makeStep({ name: "", durationLabel: "", logTarget })],
          compact: true,
          onSelectPipelineLog: () => undefined
        })
      )
    );

    assert.match(html, />Step</);
    assert.match(html, />—</);
    assert.match(html, /aria-label="Open log for step"/);
    assert.match(html, /px-2 py-1/);
  });
});

function renderSteps(steps: PipelineStageStepViewModel[]): string {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null, createElement(StepsList, { steps }))
  );
}

describe("StepsList status", () => {
  it("states each step status in text, not only by color", () => {
    const html = renderSteps([
      makeStep({ key: "a", statusLabel: "Failed", statusClass: "failure" }),
      makeStep({ key: "b", statusLabel: "", statusClass: "neutral" })
    ]);

    assert.match(html, /<span class="sr-only">, Failed<\/span>/);
    assert.match(html, /<span class="sr-only">, Status unknown<\/span>/);
  });

  it("renders a glyph for neutral steps and titles truncated names", () => {
    const html = renderSteps([makeStep({ name: "A very long step name", statusClass: "neutral" })]);

    assert.match(html, /<svg/);
    assert.match(html, /title="A very long step name"/);
  });
});

describe("BranchCard status", () => {
  it("states the branch status in text and titles the name", () => {
    const branch: PipelineStageViewModel = {
      key: "branch-1",
      name: "Linux",
      statusLabel: "Unstable",
      statusClass: "unstable",
      durationLabel: "5s",
      canRestartFromStage: false,
      hasSteps: false,
      stepsFailedOnly: [],
      stepsAll: [],
      parallelBranches: [],
      canOpenLog: false
    };
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(BranchCard, { branch, showAll: false }))
    );

    assert.match(html, /<span class="sr-only">, Unstable<\/span>/);
    assert.match(html, /title="Linux"/);
  });
});

describe("StepsVisibilityToggle", () => {
  it("keeps a fixed label and reports the failed-only state through aria-pressed", () => {
    const failedOnly = renderToStaticMarkup(
      createElement(StepsVisibilityToggle, { showAll: false, onShowAllChange: () => undefined })
    );
    const allSteps = renderToStaticMarkup(
      createElement(StepsVisibilityToggle, { showAll: true, onShowAllChange: () => undefined })
    );

    for (const html of [failedOnly, allSteps]) {
      assert.match(html, />Failed steps only</);
      assert.doesNotMatch(html, /aria-label=/);
    }
    assert.match(failedOnly, /aria-pressed="true"/);
    assert.match(allSteps, /aria-pressed="false"/);
  });
});

describe("defaultShowAllSteps", () => {
  const stage = (overrides: Partial<PipelineStageViewModel> = {}): PipelineStageViewModel => ({
    key: "stage",
    name: "Tests",
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "1s",
    canRestartFromStage: false,
    hasSteps: true,
    stepsFailedOnly: [],
    stepsAll: [makeStep()],
    parallelBranches: [],
    canOpenLog: false,
    ...overrides
  });
  const failedStep = makeStep({ key: "f", statusClass: "failure", statusLabel: "Failed" });

  it("lists every step for stages that did not fail", () => {
    assert.equal(defaultShowAllSteps(stage()), true);
    assert.equal(defaultShowAllSteps(stage({ statusClass: "neutral" })), true);
  });

  it("filters to failures for failed or unstable stages with failed steps", () => {
    assert.equal(
      defaultShowAllSteps(stage({ statusClass: "failure", stepsFailedOnly: [failedStep] })),
      false
    );
    assert.equal(
      defaultShowAllSteps(
        stage({
          statusClass: "unstable",
          parallelBranches: [stage({ key: "branch", stepsFailedOnly: [failedStep] })]
        })
      ),
      false
    );
  });

  it("keeps all steps for a failed stage with no failed step to show", () => {
    assert.equal(defaultShowAllSteps(stage({ statusClass: "failure" })), true);
  });
});

describe("formatCount", () => {
  it("uses the singular noun only for exactly one", () => {
    assert.equal(formatCount(1, "branch", "branches"), "1 branch");
    assert.equal(formatCount(2, "branch", "branches"), "2 branches");
    assert.equal(formatCount(0, "direct step"), "0 direct steps");
    assert.equal(formatCount(1, "direct step"), "1 direct step");
  });
});
