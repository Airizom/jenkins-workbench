import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { analyzeTests, normalizeHistoryReport } from "../src/history/HistoryAnalysis";
import {
  emptyHistory,
  isHistoryAction,
  normalizeHistoryUi
} from "../src/panels/jobHistory/shared/HistoryContracts";
import { HistoryContext, historyReducer } from "../src/panels/jobHistory/webview/HistoryContext";
import { HistoryView } from "../src/panels/jobHistory/webview/HistoryView";
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
  it("renders age-only continuing evidence, denominators and unavailable states", () => {
    vi.stubGlobal("window", {});
    try {
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
      const model = {
        ...emptyHistory(),
        status: "available" as const,
        selectedBuild: 3,
        builds: [{ build, report: { status: report.status } }],
        tests: analyzeTests([{ build, report }]),
        evidence: {
          [test.key]: {
            kind: "continuing" as const,
            source: "jenkins" as const,
            label: "Continuing failure · Jenkins age 2"
          }
        }
      };
      const html = renderToStaticMarkup(
        createElement(HistoryContext.Provider, { value: model }, createElement(HistoryView))
      );
      expect(html).toContain("1 continuing");
      expect(html).toContain("0/1 SUCCESS, UNSTABLE or FAILURE builds");
      expect(html).toContain("unknown");
      expect(html).toContain("Jenkins age 2");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
