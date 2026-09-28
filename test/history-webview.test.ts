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
  failureHistorySummary,
  filterTests,
  formatHistoryTimestamp,
  historyAnnouncement,
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
      expect(html).toContain("0 of 1 SUCCESS, UNSTABLE or FAILURE builds");
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
    expect(failureHistorySummary({ ...model, selectedBuild: 99 })).toBe("No failing tests");
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
    expect(outcomePresentation("missing")).toMatchObject({
      label: "Unavailable",
      tooltip: "Not reported in this build."
    });
    for (const outcome of ["missing", "unavailable", "error", "unknown", undefined] as const)
      expect(outcomePresentation(outcome).label).not.toBe("Passed");
    expect(formatHistoryTimestamp(undefined)).toBe("—");
    expect(formatHistoryTimestamp(0)).toBe("—");
    expect(
      historyJobDisplayName("https://jenkins.test/job/folder/job/app/job/feature%252Fx/")
    ).toBe("folder / app / feature/x");
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
    expect(render({ ...model, status: "paused", pausedReason: "hidden" })).toContain("Resume now");
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
