import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type {
  BuildCompareBuildViewModel,
  BuildCompareConsoleSectionViewModel
} from "../src/panels/buildCompare/shared/BuildCompareContracts";

type Deps = readonly unknown[] | undefined;

function build(roleLabel: string, displayName: string): BuildCompareBuildViewModel {
  return {
    roleLabel,
    displayName,
    buildNumberLabel: displayName,
    jobDisplayName: "demo",
    buildUrl: `https://jenkins.example/job/demo/${displayName}/`,
    resultLabel: "Success",
    resultClass: "success",
    durationLabel: "1m",
    timestampLabel: "Just now"
  };
}

function consoleSection(divergenceLine: number): BuildCompareConsoleSectionViewModel {
  const lines = [{ lineNumber: divergenceLine, text: "diverged", highlight: true }];
  return {
    status: "available",
    summaryLabel: "Console diverges",
    divergenceLineLabel: `line ${divergenceLine}`,
    baselineLines: lines.map((line) => ({ ...line })),
    targetLines: lines.map((line) => ({ ...line }))
  };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.doUnmock(
    "../src/panels/buildCompare/webview/components/buildCompare/console/consoleDivergenceScroll"
  );
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("ConsoleDivergenceSection", () => {
  it("re-centers the snippets when new available console data replaces the old", async () => {
    // Single-slot effect runtime: runs the effect only when its dependencies change.
    let previousDeps: Deps;
    const actualReact = await vi.importActual<typeof import("react")>("react");
    vi.doMock("react", () => ({
      ...actualReact,
      useEffect: (effect: () => void, deps: Deps) => {
        const changed =
          !previousDeps ||
          !deps ||
          previousDeps.length !== deps.length ||
          previousDeps.some((value, i) => !Object.is(value, deps[i]));
        previousDeps = deps;
        if (changed) {
          effect();
        }
      }
    }));
    const scroll = vi.fn();
    vi.doMock(
      "../src/panels/buildCompare/webview/components/buildCompare/console/consoleDivergenceScroll",
      () => ({ scrollConsoleSnippetsToDivergence: scroll })
    );
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const { ConsoleDivergenceSection } = await import(
      "../src/panels/buildCompare/webview/components/buildCompare/ConsoleDivergenceSection"
    );
    const props = { baseline: build("Baseline", "#1"), target: build("Target", "#2") };
    const first = consoleSection(10);

    ConsoleDivergenceSection({ ...props, section: first });
    assert.equal(scroll.mock.calls.length, 1);

    // Re-rendering the same data does not scroll again.
    ConsoleDivergenceSection({ ...props, section: { ...first } });
    assert.equal(scroll.mock.calls.length, 1);

    // A refresh that stays "available" but brings a new divergence line scrolls again.
    const second = consoleSection(42);
    ConsoleDivergenceSection({ ...props, section: second });
    assert.equal(scroll.mock.calls.length, 2);

    // Collapsing unmounts the snippets; reopening the section scrolls them again.
    const onOpenChange = () => undefined;
    ConsoleDivergenceSection({ ...props, section: second, open: false, onOpenChange });
    assert.equal(scroll.mock.calls.length, 2);
    ConsoleDivergenceSection({ ...props, section: second, open: true, onOpenChange });
    assert.equal(scroll.mock.calls.length, 3);
  });
});
