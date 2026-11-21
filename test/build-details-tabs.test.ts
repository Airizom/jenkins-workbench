import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  BUILD_DETAILS_TABS,
  PIPELINE_PRESENTATIONS,
  isBuildDetailsPanelState,
  normalizeBuildDetailsPanelUiState
} from "../src/panels/buildDetails/shared/BuildDetailsPanelWebviewState";
import {
  type BuildDetailsTabSelection,
  hasNewPendingInputs,
  reconcileBuildDetailsTabSelection,
  resolveBuildDetailsSelectedTab,
  shouldFallBackFromSelectedTab
} from "../src/panels/buildDetails/webview/components/buildDetails/buildDetailsTabsModel";

describe("BuildDetailsTabs", () => {
  it("falls back when a selected conditional tab is no longer available", () => {
    const availability = {
      hasPendingInputs: false,
      hasPipelineStages: false,
      hasTests: false
    };

    assert.equal(resolveBuildDetailsSelectedTab("inputs", availability), "overview");
    assert.equal(resolveBuildDetailsSelectedTab("pipeline", availability), "overview");
    assert.equal(resolveBuildDetailsSelectedTab("tests", availability), "overview");
  });

  it("keeps always-available tabs and prefers inputs as the fallback while inputs exist", () => {
    const availability = {
      hasPendingInputs: true,
      hasPipelineStages: false,
      hasTests: false
    };

    assert.equal(resolveBuildDetailsSelectedTab("overview", availability), "overview");
    assert.equal(resolveBuildDetailsSelectedTab("console", availability), "console");
    assert.equal(resolveBuildDetailsSelectedTab("tests", availability), "inputs");
  });

  it("normalizes every declared persisted tab and pipeline presentation", () => {
    for (const selectedTab of BUILD_DETAILS_TABS) {
      assert.equal(normalizeBuildDetailsPanelUiState({ selectedTab })?.selectedTab, selectedTab);
    }
    for (const pipelinePresentation of PIPELINE_PRESENTATIONS) {
      assert.equal(
        normalizeBuildDetailsPanelUiState({ pipelinePresentation })?.pipelinePresentation,
        pipelinePresentation
      );
    }
    assert.equal(normalizeBuildDetailsPanelUiState({ selectedTab: "invalid" }), undefined);
    assert.equal(normalizeBuildDetailsPanelUiState({ pipelinePresentation: "invalid" }), undefined);
  });

  it("accepts an empty UI-state record but rejects an empty array", () => {
    const state = {
      environmentId: "env-1",
      scope: "workspace",
      buildUrl: "https://jenkins.example/job/example/1/"
    } as const;

    assert.equal(isBuildDetailsPanelState({ ...state, buildDetailsUi: {} }), true);
    assert.equal(isBuildDetailsPanelState({ ...state, buildDetailsUi: [] }), false);
  });

  it("detects pending inputs that were not seen before", () => {
    assert.equal(hasNewPendingInputs(new Set(), ["a"]), true);
    assert.equal(hasNewPendingInputs(new Set(["a"]), ["a"]), false);
    assert.equal(hasNewPendingInputs(new Set(["a"]), ["a", "b"]), true);
    assert.equal(hasNewPendingInputs(new Set(["a"]), []), false);
  });

  it("selects new inputs until the user chooses a tab and requests focus when Inputs disappears", () => {
    const initial: BuildDetailsTabSelection = {
      tab: "overview",
      wasAvailable: true,
      userChoseTab: false,
      seenInputIds: [],
      persist: false
    };
    const withInputs = {
      availableTabs: ["overview", "inputs", "console"],
      defaultTab: "inputs",
      detailsLoaded: true,
      pendingInputIds: ["approval"]
    } as const;
    const automatic = reconcileBuildDetailsTabSelection(initial, withInputs);
    assert.equal(automatic.tab, "inputs");
    assert.equal(automatic.persist, true);
    assert.equal(
      reconcileBuildDetailsTabSelection(automatic, {
        ...withInputs,
        pendingInputIds: ["approval"]
      }),
      automatic
    );

    const explicit = reconcileBuildDetailsTabSelection(
      { ...initial, tab: "console", userChoseTab: true },
      withInputs
    );
    assert.equal(explicit.tab, "console");

    const afterApproval = reconcileBuildDetailsTabSelection(automatic, {
      availableTabs: ["overview", "console"],
      defaultTab: "overview",
      detailsLoaded: true,
      pendingInputIds: []
    });
    assert.equal(afterApproval.tab, "overview");
    assert.deepEqual(afterApproval.focusRequest, { tab: "overview" });
  });

  it("replaces a restored tab that is still unavailable once details have loaded", () => {
    // Before details arrive, a restored tab waits for its availability.
    assert.equal(
      shouldFallBackFromSelectedTab({
        isAvailable: false,
        wasAvailable: false,
        detailsLoaded: false
      }),
      false
    );
    // Details loaded without the restored tab (its input was approved elsewhere).
    assert.equal(
      shouldFallBackFromSelectedTab({
        isAvailable: false,
        wasAvailable: false,
        detailsLoaded: true
      }),
      true
    );
    // A tab that disappears after being shown still falls back.
    assert.equal(
      shouldFallBackFromSelectedTab({
        isAvailable: false,
        wasAvailable: true,
        detailsLoaded: false
      }),
      true
    );
    assert.equal(
      shouldFallBackFromSelectedTab({
        isAvailable: true,
        wasAvailable: false,
        detailsLoaded: true
      }),
      false
    );
  });
});
