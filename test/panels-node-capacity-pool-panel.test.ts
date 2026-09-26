import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { NodeCapacitySeverity } from "../src/shared/nodeCapacity/NodeCapacityContracts";
import { isUserInitiatedPoolToggle } from "../src/panels/nodeCapacity/webview/components/NodeCapacityPoolPanel";

/**
 * Mirrors how NodeCapacityApp resolves a pool's open state: an explicit user
 * override wins, otherwise abnormal severity expands the pool.
 */
function resolveOpen(override: boolean | undefined, severity: NodeCapacitySeverity): boolean {
  return override ?? severity !== "normal";
}

describe("isUserInitiatedPoolToggle", () => {
  it("ignores toggle events caused by the controlled open prop changing", () => {
    // React already re-rendered with the new prop by the time `toggle` fires.
    assert.equal(isUserInitiatedPoolToggle(true, true), false);
    assert.equal(isUserInitiatedPoolToggle(false, false), false);
  });

  it("records toggles where the DOM diverges from the controlled prop", () => {
    assert.equal(isUserInitiatedPoolToggle(true, false), true);
    assert.equal(isUserInitiatedPoolToggle(false, true), true);
  });

  it("does not turn automatic severity expansion into a persistent override", () => {
    let override: boolean | undefined;
    const applyToggle = (domOpen: boolean, controlledOpen: boolean) => {
      if (isUserInitiatedPoolToggle(domOpen, controlledOpen)) {
        override = domOpen;
      }
    };

    // Untouched normal pool: closed.
    assert.equal(resolveOpen(override, "normal"), false);

    // Refresh into warning: React sets open=true, then the browser fires
    // `toggle` with the DOM matching the already-updated prop.
    const warningOpen = resolveOpen(override, "warning");
    assert.equal(warningOpen, true);
    applyToggle(true, warningOpen);
    assert.equal(override, undefined);

    // Refresh back to normal: same sequence with open=false.
    const normalOpen = resolveOpen(override, "normal");
    applyToggle(false, normalOpen);
    assert.equal(override, undefined);
    assert.equal(normalOpen, false);
  });

  it("still lets a user collapse an automatically expanded pool", () => {
    let override: boolean | undefined;
    const controlledOpen = resolveOpen(override, "critical");
    assert.equal(controlledOpen, true);

    // User clicks the summary: the browser flips the DOM before React sees it.
    if (isUserInitiatedPoolToggle(false, controlledOpen)) {
      override = false;
    }
    assert.equal(override, false);
    assert.equal(resolveOpen(override, "critical"), false);
  });
});
