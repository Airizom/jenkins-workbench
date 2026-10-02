import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { analyzeTests, normalizeHistoryReport } from "../src/history/HistoryAnalysis";
import {
  emptyHistory,
  type HistoryViewModel,
  historyJobDisplayName,
  isHistoryAction,
  normalizeHistoryUi
} from "../src/panels/jobHistory/shared/HistoryContracts";
import { HistoryContext, historyReducer } from "../src/panels/jobHistory/webview/HistoryContext";
import { HistoryTestsSection } from "../src/panels/jobHistory/webview/HistoryTestsSection";
import { HistoryView } from "../src/panels/jobHistory/webview/HistoryView";
import {
  compareBuildsLabel,
  failureHistorySummary,
  filterTests,
  formatHistoryTimestamp,
  historyAnnouncement,
  observationGaps,
  outcomePresentation
} from "../src/panels/jobHistory/webview/historyPresentation";
import { mergeBuildDetailsPanelState } from "../src/panels/buildDetails/shared/BuildDetailsPanelWebviewState";

describe("history webview contract", () => {
  it("ignores unrelated and stale messages and rejects malformed actions", () => {
    const state = { ...emptyHistory(), revision: 4 };
    expect(historyReducer(state, { type: "other" })).toBe(state);
    expect(historyReducer(state, { ...state, revision: 3 })).toBe(state);
    expect(
      isHistoryAction({
        type: "historyAction",
        action: "openBuild",
        revision: 1,
        value: "https://evil.test/"
      })
    ).toBe(false);
    expect(isHistoryAction({ type: "historyAction", action: "deleteBuild", revision: 1 })).toBe(
      false
    );
    expect(normalizeHistoryUi({ count: 1000, filter: "invalid" }).count).toBe(20);
  });
  it("preserves embedded UI state only for the same build", () => {
    const environment = {
      environmentId: "e",
      scope: "workspace" as const,
      url: "https://jenkins.test/"
    };
    const state = {
      ...environment,
      buildUrl: "https://jenkins.test/job/a/1/",
      historyUi: { count: 50, search: "suite", filter: "continuing", selectedTest: "test" }
    };
    expect(mergeBuildDetailsPanelState(state, environment, state.buildUrl).historyUi).toEqual(
      normalizeHistoryUi(state.historyUi)
    );
    expect(
      mergeBuildDetailsPanelState(state, environment, "https://jenkins.test/job/a/2/").historyUi
    ).toBeUndefined();
  });
  it("renders newest-first builds, still-failing evidence and inline test disclosure", () => {
    vi.stubGlobal("window", {});
    try {
      const model = failingModel();
      const html = renderToStaticMarkup(
        createElement(HistoryContext.Provider, { value: model }, createElement(HistoryView))
      );
      expect(html).toContain("Still failing · Jenkins age 2");
      expect(html).toContain("Success rate 0% · 0 of 1 completed build passed");
      expect(html).not.toContain("SUCCESS, UNSTABLE or FAILURE");
      // Standalone panels mark the analyzed build as "Selected", not "This build".
      expect(html).toContain(">Selected<");
      expect(html).not.toContain("This build");
      expect(html).toContain('aria-label="Open build #3 details"');
      expect(html).toContain("Builds · newest first");
      expect(html).not.toContain("Chronological");
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain("Open in Jenkins");
      // The selected build never offers to compare with itself.
      expect(html).not.toContain("Compare with #3");
      // The raw job URL is not rendered as page text.
      expect(html).not.toContain(">https://jenkins.test/job/a/<");
      expect(html).not.toContain("0 skipped");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("summarizes embedded failure history only once counts are meaningful", () => {
    const model = failingModel();
    expect(failureHistorySummary({ ...model, status: "loading" })).toBe("Loading failure history…");
    expect(failureHistorySummary(model, true)).toBe("Available after the build completes");
    expect(failureHistorySummary({ ...model, status: "paused", pausedReason: "building" })).toBe(
      "Available after the build completes"
    );
    expect(failureHistorySummary({ ...model, status: "paused", pausedReason: "hidden" })).toBe(
      "Paused while hidden"
    );
    expect(failureHistorySummary({ ...model, status: "unavailable" })).toBe("Unavailable");
    expect(failureHistorySummary(model)).toBe("1 failing · 1 still failing");
    // A selected build without a usable report never reads as "No failing tests".
    expect(failureHistorySummary({ ...model, selectedBuild: 99 })).toBe(
      "Test report unavailable for this build"
    );
    expect(
      failureHistorySummary({
        ...model,
        builds: [{ ...model.builds[0], report: { status: "unavailable" } }]
      })
    ).toBe("Test report unavailable for this build");
    expect(
      failureHistorySummary({
        ...model,
        builds: [{ ...model.builds[0], report: { status: "available", truncated: true } }]
      })
    ).toBe("Test report partial · 1 failing · 1 still failing");
    expect(failureHistorySummary({ ...model, tests: [], evidence: {} })).toBe("No failing tests");
    vi.stubGlobal("window", {});
    try {
      const html = renderToStaticMarkup(
        createElement(
          HistoryContext.Provider,
          { value: { ...model, status: "loading" as const, builds: [], tests: [] } },
          createElement(HistoryView, { embedded: true })
        )
      );
      expect(html).toContain("Loading failure history…");
      expect(html).not.toMatch(/\b0 (new|continuing|intermittent)/);
      expect(html).not.toContain("No matching test observations");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("announces only state transitions", () => {
    const model = failingModel();
    expect(historyAnnouncement(model)).toBe("Loaded 1 build");
    expect(historyAnnouncement({ ...model, revision: model.revision + 3 })).toBe("Loaded 1 build");
    expect(historyAnnouncement({ ...model, status: "paused", pausedReason: "hidden" })).toBe(
      "Paused while panel is hidden"
    );
    expect(historyReducer(model, { ...model, status: "paused", revision: 9 }).status).toBe(
      "paused"
    );
  });
  it("labels evidence gaps as ambiguous or unavailable, never passed", () => {
    expect(outcomePresentation("ambiguous")).toMatchObject({ label: "Ambiguous", gap: true });
    expect(outcomePresentation("ambiguous").tooltip).toContain("Duplicate test identity");
    expect(outcomePresentation("missing")).toMatchObject({ label: "Not reported", gap: true });
    expect(outcomePresentation("unavailable")).toMatchObject({ label: "Unavailable", gap: true });
    for (const outcome of ["missing", "unavailable", "error", "unknown", undefined] as const)
      expect(outcomePresentation(outcome).label).not.toBe("Passed");
    expect(formatHistoryTimestamp(undefined)).toBe("—");
    expect(formatHistoryTimestamp(0)).toBe("—");
    expect(
      historyJobDisplayName("https://jenkins.test/job/folder/job/app/job/feature%252Fx/")
    ).toBe("folder » app » feature/x");
  });
});

describe("history webview states", () => {
  function render(model: HistoryViewModel, props: { buildRunning?: boolean } = {}): string {
    vi.stubGlobal("window", {});
    try {
      return renderToStaticMarkup(
        createElement(HistoryContext.Provider, { value: model }, createElement(HistoryView, props))
      );
    } finally {
      vi.unstubAllGlobals();
    }
  }
  it("renders placeholder states before history is loaded", () => {
    const model = failingModel();
    expect(render(model, { buildRunning: true })).toContain("Failure history compares finished");
    expect(render({ ...model, status: "idle" })).toContain("Load history");
    expect(render({ ...model, status: "idle", jobUrl: "" })).toContain("Loading history…");
    expect(render({ ...model, status: "paused", pausedReason: "hidden" })).toContain(">Resume<");
    expect(render({ ...model, status: "loading", builds: [] })).toContain("Loading…");
  });
  it("renders failures and warnings alongside the toolbar", () => {
    const model = failingModel();
    expect(render({ ...model, status: "error", message: "boom" })).toContain(
      "History failed to load: boom"
    );
    expect(render({ ...model, status: "error" })).toContain("History failed to load.");
    expect(render({ ...model, status: "unavailable" })).toContain(
      "No builds in this window have history to analyze."
    );
    const partial = render({
      ...model,
      status: "partial",
      message: "Some reports failed",
      truncated: true,
      testsTruncated: true
    });
    expect(partial).toContain("Some reports failed");
    expect(partial).toContain("Lookup capped at 500 build summaries.");
  });
  it("offers comparison only from other builds and hides unfinished durations", () => {
    const model = failingModel();
    const html = render({
      ...model,
      builds: [
        {
          build: { number: 4, url: "https://jenkins.test/job/a/4/", building: true },
          report: { status: "unavailable" }
        },
        ...model.builds
      ]
    });
    expect(html).toContain("Compare with #3");
    expect(html).toContain("—");
  });
  it("renders the expanded test with its baseline outcome", () => {
    const model = failingModel();
    const key = model.tests[0].key;
    const html = renderToStaticMarkup(
      createElement(HistoryTestsSection, {
        model: {
          ...model,
          baseline: { status: "available" },
          baselineOutcomes: { [key]: "failed" }
        },
        ui: { ...normalizeHistoryUi({}), selectedTest: key },
        setUi: () => undefined,
        send: () => undefined
      })
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Outcomes by build, newest first.");
    expect(html).toContain("Baseline: Also failing");
    expect(html).toContain("suite");
  });
  it("filters tests by search and failure kind", () => {
    const model = failingModel();
    const ui = normalizeHistoryUi({});
    const count = (filter: string, search = "") =>
      filterTests(model, { ...ui, search, filter: filter as typeof ui.filter }).length;
    expect(count("all")).toBe(1);
    expect(count("all", "SUITE")).toBe(1);
    expect(count("all", "nothing")).toBe(0);
    expect(count("failed")).toBe(1);
    expect(count("continuing")).toBe(1);
    expect(count("new")).toBe(0);
    expect(count("intermittent")).toBe(0);
    expect(count("baseline")).toBe(0);
    expect(count("unexpected")).toBe(1);
    const key = model.tests[0].key;
    expect(
      filterTests(
        { ...model, baselineOutcomes: { [key]: "failed" } },
        { ...ui, filter: "baseline" }
      )
    ).toHaveLength(1);
  });
});

describe("history test ordering and labels", () => {
  function sortingModel(): HistoryViewModel {
    const builds = [5, 4, 3].map((number) => ({
      number,
      url: `https://jenkins.test/job/a/${number}/`,
      result: "UNSTABLE"
    }));
    const cases = (outcomes: Record<string, string>) =>
      normalizeHistoryReport({
        suites: [
          {
            name: "suite",
            cases: Object.entries(outcomes).map(([name, status]) => ({ name, status }))
          }
        ]
      });
    // "flaky" is intermittent (the old default leader); "fresh" newly fails in #5.
    const observations = [
      { build: builds[0], report: cases({ flaky: "FAILED", fresh: "FAILED", still: "FAILED" }) },
      { build: builds[1], report: cases({ flaky: "PASSED", fresh: "PASSED", still: "FAILED" }) },
      { build: builds[2], report: cases({ flaky: "FAILED", fresh: "PASSED", still: "FAILED" }) }
    ];
    const tests = analyzeTests(observations);
    const key = (name: string) => tests.find((test) => test.name === name)?.key ?? "";
    return {
      ...emptyHistory(),
      jobUrl: "https://jenkins.test/job/a/",
      status: "available",
      selectedBuild: 5,
      builds: observations.map(({ build, report }) => ({
        build,
        report: { status: report.status }
      })),
      tests,
      evidence: {
        [key("fresh")]: { kind: "new", source: "sample", label: "New failure" },
        [key("still")]: { kind: "continuing", source: "sample", label: "Still failing" },
        [key("flaky")]: { kind: "new", source: "sample", label: "New failure" }
      }
    };
  }
  it("puts tests failing in the selected build first, new failures before still failing", () => {
    const model = sortingModel();
    expect(model.tests[0].name).toBe("flaky");
    const ui = normalizeHistoryUi({});
    expect(ui.sort).toBe("relevance");
    expect(filterTests(model, ui).map((test) => test.name)).toEqual(["flaky", "fresh", "still"]);
    const flaky = model.tests.find((test) => test.name === "flaky");
    const withoutFlakyFailure: HistoryViewModel = {
      ...model,
      evidence: Object.fromEntries(
        Object.entries(model.evidence).filter(([key]) => key !== flaky?.key)
      )
    };
    // Without evidence a failing test ranks after new and still-failing ones.
    expect(filterTests(withoutFlakyFailure, ui).map((test) => test.name)).toEqual([
      "fresh",
      "still",
      "flaky"
    ]);
    expect(filterTests(model, { ...ui, sort: "name" }).map((test) => test.name)).toEqual([
      "flaky",
      "fresh",
      "still"
    ]);
    expect(filterTests(model, { ...ui, sort: "failureRate" })[0].name).toBe("still");
    expect(filterTests(model, { ...ui, sort: "transitions" })[0].name).toBe("flaky");
    expect(normalizeHistoryUi({ sort: "bogus", open: "yes" })).toMatchObject({
      sort: "relevance",
      open: false
    });
    expect(normalizeHistoryUi({ sort: "name", open: true })).toMatchObject({
      sort: "name",
      open: true
    });
  });
  it("reports build-level report gaps once instead of on every test row", () => {
    const model = sortingModel();
    const unavailable: HistoryViewModel = {
      ...model,
      builds: model.builds.map((item, index) =>
        index === 1 ? { ...item, report: { status: "unavailable" } } : item
      ),
      tests: model.tests.map((test) => ({
        ...test,
        outcomes: test.outcomes.map((outcome, index) => (index === 1 ? "unavailable" : outcome)),
        unavailable: 1
      }))
    };
    expect(observationGaps(unavailable.tests[0], unavailable)).toEqual([]);
    const html = renderToStaticMarkup(
      createElement(HistoryTestsSection, {
        model: unavailable,
        ui: normalizeHistoryUi({}),
        setUi: () => undefined,
        send: () => undefined
      })
    );
    expect(html).toContain("No test report for build #4");
    expect(html).toContain("not counted as passes");
    // A truncated report leaves test-level gaps, which stay on the row.
    const truncated: HistoryViewModel = {
      ...unavailable,
      builds: unavailable.builds.map((item, index) =>
        index === 1 ? { ...item, report: { status: "available", truncated: true } } : item
      )
    };
    expect(observationGaps(truncated.tests[0], truncated).map((gap) => gap.label)).toEqual([
      "1 unavailable"
    ]);
  });
  it("names compare buttons with the visible text and the comparison direction", () => {
    expect(compareBuildsLabel(45, 48)).toBe("Compare with #48: #45 as baseline, #48 as target");
    expect(compareBuildsLabel(50, 48)).toBe("Compare with #48: #48 as baseline, #50 as target");
  });
  it("keeps a collapsed embedded history quiet and restores its open state", async () => {
    const model = failingModel();
    // The VS Code API is cached per module instance, so load fresh copies per saved state.
    const render = async (historyUi: unknown) => {
      vi.resetModules();
      vi.stubGlobal("window", {
        acquireVsCodeApi: () => ({
          getState: () => ({ historyUi }),
          setState: () => undefined,
          postMessage: () => undefined
        })
      });
      try {
        const context = await import("../src/panels/jobHistory/webview/HistoryContext");
        const view = await import("../src/panels/jobHistory/webview/HistoryView");
        return renderToStaticMarkup(
          createElement(
            context.HistoryContext.Provider,
            { value: model },
            createElement(view.HistoryView, { embedded: true })
          )
        );
      } finally {
        vi.unstubAllGlobals();
      }
    };
    const collapsed = await render({ open: false });
    expect(collapsed).toContain('<p role="status" aria-live="polite" class="sr-only"></p>');
    expect(collapsed).toContain('aria-expanded="false"');
    const expanded = await render({ open: true });
    expect(expanded).toContain("Loaded 1 build");
    expect(expanded).toContain('aria-expanded="true"');
    // Embedded history keeps "This build" for the panel's own build.
    expect(expanded).not.toContain(">Selected<");
  });
});

function failingModel(): HistoryViewModel {
  const report = normalizeHistoryReport({
    suites: [{ name: "suite", cases: [{ name: "test", status: "FAILED", age: 2 }] }]
  });
  const build = {
    number: 3,
    url: "https://jenkins.test/job/a/3/",
    result: "FAILURE",
    duration: 1000
  };
  const test = report.cases[0];
  return {
    ...emptyHistory(),
    jobUrl: "https://jenkins.test/job/a/",
    status: "available",
    selectedBuild: 3,
    builds: [{ build, report: { status: report.status } }],
    tests: analyzeTests([{ build, report }]),
    evidence: {
      [test.key]: {
        kind: "continuing",
        source: "jenkins",
        label: "Still failing · Jenkins age 2"
      }
    }
  };
}
