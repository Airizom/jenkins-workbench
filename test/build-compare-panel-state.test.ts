import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { BuildComparePanelSerializedState } from "../src/panels/buildCompare/shared/BuildComparePanelWebviewState";

type PanelStateModule =
  typeof import("../src/panels/buildCompare/webview/lib/buildComparePanelState");

describe("buildComparePanelState", () => {
  let savedState: unknown;

  async function loadModule(): Promise<PanelStateModule> {
    return import("../src/panels/buildCompare/webview/lib/buildComparePanelState");
  }

  function hostState(
    overrides: Partial<BuildComparePanelSerializedState> = {}
  ): BuildComparePanelSerializedState {
    return {
      environmentId: "env-1",
      scope: "workspace",
      baselineBuildUrl: "https://jenkins.example/job/demo/1/",
      targetBuildUrl: "https://jenkins.example/job/demo/2/",
      ...overrides
    };
  }

  beforeEach(() => {
    vi.resetModules();
    savedState = undefined;
    vi.stubGlobal("window", {
      acquireVsCodeApi: () => ({
        postMessage: () => undefined,
        getState: () => savedState,
        setState: (state: unknown) => {
          savedState = state;
          return state;
        }
      })
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("writes UI state while keeping host-owned keys", async () => {
    savedState = { ...hostState(), compareUi: { collapsedSections: ["tests"] } };
    const { writeBuildCompareUiState } = await loadModule();

    writeBuildCompareUiState({ expandedSections: ["console"] });

    assert.deepEqual(savedState, {
      ...hostState(),
      compareUi: { expandedSections: ["console"] }
    });
  });

  it("adopts host state, replacing host keys and keeping webview UI state", async () => {
    savedState = {
      ...hostState(),
      staleHostKey: true,
      compareUi: { collapsedSections: ["tests", "bogus", "tests"] }
    };
    const { adoptHostPanelState } = await loadModule();
    const nextHostState = hostState({
      baselineBuildUrl: "https://jenkins.example/job/demo/3/",
      targetBuildUrl: "https://jenkins.example/job/demo/4/",
      compareUi: { expandedSections: ["stages"] }
    });

    adoptHostPanelState(nextHostState);

    assert.deepEqual(savedState, {
      ...nextHostState,
      compareUi: { collapsedSections: ["tests"] }
    });
  });

  it("keeps adopted host keys on a later UI write", async () => {
    const { adoptHostPanelState, writeBuildCompareUiState } = await loadModule();
    const nextHostState = hostState({ targetBuildUrl: "https://jenkins.example/job/demo/9/" });

    adoptHostPanelState(nextHostState);
    writeBuildCompareUiState({ collapsedSections: ["parameters"] });

    assert.deepEqual(savedState, {
      ...nextHostState,
      compareUi: { collapsedSections: ["parameters"] }
    });
  });

  for (const [label, value] of [
    ["undefined", undefined],
    ["null", null],
    ["a string", "saved"],
    ["an array", [{ compareUi: { collapsedSections: ["tests"] } }]]
  ] as const) {
    it(`reads default UI state when saved state is ${label}`, async () => {
      savedState = value;
      const { readBuildCompareUiState, writeBuildCompareUiState } = await loadModule();

      assert.deepEqual(readBuildCompareUiState(), {});

      writeBuildCompareUiState({ collapsedSections: ["tests"] });
      assert.deepEqual(savedState, { compareUi: { collapsedSections: ["tests"] } });
    });
  }
});
