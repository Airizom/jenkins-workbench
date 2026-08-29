import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  isNodeDetailsTab,
  loadAdvancedNodeDetailsForTab,
  NODE_DETAILS_TABS
} from "../src/panels/nodeDetails/webview/nodeDetailsTabValues";

describe("Node Details tab values", () => {
  it("recognizes every declared tab value", () => {
    for (const value of Object.values(NODE_DETAILS_TABS)) {
      assert.equal(isNodeDetailsTab(value), true);
    }
  });

  it("rejects an unknown tab value", () => {
    assert.equal(isNodeDetailsTab("diagnostic"), false);
  });

  it("loads advanced details only when the unloaded Diagnostics tab is activated", () => {
    let loadCount = 0;
    const load = () => {
      loadCount += 1;
    };

    for (const tab of Object.values(NODE_DETAILS_TABS)) {
      loadAdvancedNodeDetailsForTab(tab, false, load);
    }
    loadAdvancedNodeDetailsForTab(NODE_DETAILS_TABS.DIAGNOSTICS, true, load);

    assert.equal(loadCount, 1);
  });
});
