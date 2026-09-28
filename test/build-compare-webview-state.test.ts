import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  BuildCompareStageDiffItem,
  BuildCompareViewModel
} from "../src/panels/buildCompare/shared/BuildCompareContracts";
import {
  isBuildComparePanelState,
  normalizeBuildComparePanelUiState
} from "../src/panels/buildCompare/shared/BuildComparePanelWebviewState";
import { resolveCompareSectionNavChip } from "../src/panels/buildCompare/webview/components/buildCompare/compareSectionNavModel";
import {
  buildCompareReducer,
  createBuildCompareState
} from "../src/panels/buildCompare/webview/state/buildCompareState";

function createModel(overrides: Partial<BuildCompareViewModel> = {}): BuildCompareViewModel {
  const build = (number: number) => ({
    roleLabel: number === 1 ? "Baseline" : "Target",
    displayName: `demo #${number}`,
    buildNumberLabel: `#${number}`,
    jobDisplayName: "demo",
    buildUrl: `https://jenkins.example/job/demo/${number}/`,
    resultLabel: "Success",
    resultClass: "success",
    durationLabel: "1m",
    timestampLabel: "now"
  });
  return {
    title: "Build Compare",
    baseline: build(1),
    target: build(2),
    tests: {
      status: "empty",
      summaryLabel: "No high-signal test differences",
      baselineSummaryLabel: "",
      targetSummaryLabel: "",
      newFailures: [],
      stillFailing: [],
      newPasses: [],
      addedTests: [],
      removedTests: [],
      otherChanges: [],
      ambiguousTests: [],
      unchangedCount: 0
    },
    parameters: { status: "empty", summaryLabel: "", items: [], unchangedCount: 0 },
    changesets: { status: "empty", summaryLabel: "", baselineItems: [], targetItems: [] },
    stages: { status: "empty", summaryLabel: "", items: [] },
    console: { status: "loading", summaryLabel: "", baselineLines: [], targetLines: [] },
    errors: [],
    ...overrides
  };
}

describe("buildCompareReducer", () => {
  it("keeps the previous comparison when a refresh fails and remembers the action", () => {
    const model = createModel();
    let state = createBuildCompareState(model);
    state = buildCompareReducer(state, { type: "startAction", action: "swap" });
    assert.equal(state.busyAction, "swap");

    state = buildCompareReducer(state, { type: "actionFailed", message: "HTTP 503" });

    assert.equal(state.model, model);
    assert.equal(state.busyAction, undefined);
    assert.deepEqual(state.actionError, { action: "swap", message: "HTTP 503" });
  });

  it("replaces the comparison, clears errors, and records the completed action", () => {
    let state = createBuildCompareState(createModel());
    state = buildCompareReducer(state, { type: "startAction", action: "refresh" });
    const next = createModel({ title: "Next" });

    state = buildCompareReducer(state, { type: "replaceComparison", model: next });

    assert.equal(state.model, next);
    assert.equal(state.busyAction, undefined);
    assert.equal(state.actionError, undefined);
    assert.deepEqual(state.completedAction, { action: "refresh", sequence: 1 });
  });
});

describe("normalizeBuildComparePanelUiState", () => {
  it("keeps only known, unique section ids", () => {
    assert.deepEqual(
      normalizeBuildComparePanelUiState({
        collapsedSections: ["tests", "bogus", "tests", 4, "console"]
      }),
      { collapsedSections: ["tests", "console"] }
    );
    assert.deepEqual(normalizeBuildComparePanelUiState(undefined), {});
    assert.deepEqual(normalizeBuildComparePanelUiState({ collapsedSections: "tests" }), {});
  });

  it("accepts persisted state with or without UI state", () => {
    const base = {
      environmentId: "env-1",
      scope: "workspace",
      baselineBuildUrl: "https://jenkins.example/job/a/1/",
      targetBuildUrl: "https://jenkins.example/job/a/2/"
    };
    assert.equal(isBuildComparePanelState(base), true);
    assert.equal(isBuildComparePanelState({ ...base, compareUi: { collapsedSections: [] } }), true);
    assert.equal(isBuildComparePanelState({ ...base, compareUi: [] }), false);
  });
});

describe("resolveCompareSectionNavChip", () => {
  const stage = (overrides: Partial<BuildCompareStageDiffItem>): BuildCompareStageDiffItem => ({
    key: "s",
    name: "s",
    changeType: "matched",
    baselineStatusClass: "success",
    targetStatusClass: "success",
    ...overrides
  });

  it("distinguishes unavailable from empty sections", () => {
    const model = createModel({
      stages: { status: "unavailable", summaryLabel: "", items: [] }
    });
    assert.deepEqual(resolveCompareSectionNavChip("stages", model), {
      text: "n/a",
      tone: "muted"
    });
    assert.deepEqual(resolveCompareSectionNavChip("parameters", model), {
      text: "no changes",
      tone: "neutral"
    });
  });

  it("uses the failure tone for regressions and neutral tone for improvements", () => {
    const failing = createModel({
      tests: {
        ...createModel().tests,
        status: "available",
        newFailures: [
          { key: "a", name: "a", baselineStatusLabel: "Passed", targetStatusLabel: "Failed" },
          { key: "b", name: "b", baselineStatusLabel: "Passed", targetStatusLabel: "Failed" }
        ]
      }
    });
    assert.deepEqual(resolveCompareSectionNavChip("tests", failing), {
      text: "2 new failures",
      tone: "failure"
    });

    const passing = createModel({
      tests: {
        ...createModel().tests,
        status: "available",
        newPasses: [
          { key: "a", name: "a", baselineStatusLabel: "Failed", targetStatusLabel: "Passed" }
        ]
      }
    });
    assert.deepEqual(resolveCompareSectionNavChip("tests", passing), {
      text: "1 newly passing",
      tone: "neutral"
    });
  });

  it("counts only significant slowdowns for stages", () => {
    const model = createModel({
      stages: {
        status: "available",
        summaryLabel: "",
        items: [
          stage({ key: "a", deltaDirection: "slower", deltaSignificant: false }),
          stage({ key: "b", deltaDirection: "slower", deltaSignificant: true })
        ]
      }
    });
    assert.deepEqual(resolveCompareSectionNavChip("stages", model), {
      text: "1 slower",
      tone: "failure"
    });
  });
});
