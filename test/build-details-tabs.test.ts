import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBuildDetailsSelectedTab } from "../src/panels/buildDetails/webview/components/buildDetails/buildDetailsTabsModel";

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
});
