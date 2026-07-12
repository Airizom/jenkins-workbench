import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  buildStepRows,
  getStepRowPaddingClass
} from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/stepsListModel";

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

describe("buildStepRows", () => {
  it("maps step fields through to rows", () => {
    const logTarget: PipelineLogTargetViewModel = {
      key: "step-1",
      kind: "step",
      name: "Checkout",
      nodeId: "12"
    };
    const rows = buildStepRows([makeStep({ logTarget })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.key, "Checkout-0");
    assert.equal(rows[0]?.name, "Checkout");
    assert.equal(rows[0]?.statusClass, "success");
    assert.equal(rows[0]?.durationLabel, "3s");
    assert.equal(rows[0]?.logLabel, "Open log for Checkout");
    assert.equal(rows[0]?.logTarget, logTarget);
  });

  it("keeps rows keyed by name and index", () => {
    const rows = buildStepRows([makeStep({ name: "sh" }), makeStep({ name: "sh" })]);
    assert.deepEqual(
      rows.map((row) => row.key),
      ["sh-0", "sh-1"]
    );
  });

  it("falls back to a generic step name and duration placeholder", () => {
    const rows = buildStepRows([makeStep({ name: "", durationLabel: "" })]);
    assert.equal(rows[0]?.name, "Step");
    assert.equal(rows[0]?.durationLabel, "—");
    assert.equal(rows[0]?.logLabel, "Open log for step");
    assert.equal(rows[0]?.logTarget, undefined);
  });

  it("uses the generic log label for whitespace-only names", () => {
    const rows = buildStepRows([makeStep({ name: "   " })]);
    assert.equal(rows[0]?.logLabel, "Open log for step");
    assert.equal(rows[0]?.name, "   ");
    assert.equal(rows[0]?.key, "   -0");
  });
});

describe("getStepRowPaddingClass", () => {
  it("uses tighter padding in compact mode", () => {
    assert.equal(getStepRowPaddingClass(true), "px-2 py-1");
  });

  it("uses regular padding otherwise", () => {
    assert.equal(getStepRowPaddingClass(false), "px-2.5 py-1.5");
  });
});
