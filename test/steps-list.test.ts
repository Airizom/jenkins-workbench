import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { StepsList } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/StepsList";
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
