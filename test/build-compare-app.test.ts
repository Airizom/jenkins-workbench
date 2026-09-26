import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  BuildCompareBuildViewModel,
  BuildCompareViewModel,
  CompareSectionStatus
} from "../src/panels/buildCompare/shared/BuildCompareContracts";
import { BuildCompareApp } from "../src/panels/buildCompare/webview/BuildCompareApp";

type SectionKey = "tests" | "parameters" | "changesets" | "stages" | "console";

const SECTION_KEYS: SectionKey[] = ["tests", "parameters", "changesets", "stages", "console"];

function build(roleLabel: string, displayName: string): BuildCompareBuildViewModel {
  return {
    roleLabel,
    displayName,
    buildUrl: `https://jenkins.example/job/demo/${displayName}/`,
    resultLabel: "Success",
    resultClass: "success",
    durationLabel: "1m",
    timestampLabel: "Just now"
  };
}

function createState(
  statuses: Partial<Record<SectionKey, CompareSectionStatus>>
): BuildCompareViewModel {
  const status = (key: SectionKey): CompareSectionStatus => statuses[key] ?? "identical";
  return {
    title: "Compare #1 with #2",
    baseline: build("Baseline", "#1"),
    target: build("Target", "#2"),
    tests: {
      status: status("tests"),
      summaryLabel: "Tests",
      baselineSummaryLabel: "0 tests",
      targetSummaryLabel: "0 tests",
      newFailures: [],
      stillFailing: [],
      newPasses: [],
      addedTests: [],
      removedTests: [],
      otherChangesCount: 0,
      unchangedCount: 0
    },
    parameters: {
      status: status("parameters"),
      summaryLabel: "Parameters",
      items: [],
      unchangedCount: 0
    },
    changesets: {
      status: status("changesets"),
      summaryLabel: "Changes",
      baselineItems: [],
      targetItems: []
    },
    stages: {
      status: status("stages"),
      summaryLabel: "Stages",
      items: []
    },
    console: {
      status: status("console"),
      summaryLabel: "Console",
      baselineLines: [],
      targetLines: []
    },
    errors: []
  };
}

function render(state: BuildCompareViewModel): string {
  return renderToStaticMarkup(createElement(BuildCompareApp, { initialState: state }));
}

function isGloballyLoading(html: string): boolean {
  return html.includes('aria-busy="true"');
}

describe("BuildCompareApp global loading state", () => {
  for (const key of SECTION_KEYS) {
    it(`reports loading while only the ${key} section is still loading`, () => {
      const html = render(createState({ [key]: "loading" }));

      assert.equal(isGloballyLoading(html), true, `main should be aria-busy while ${key} loads`);
      assert.match(html, /role="progressbar"/, `progress bar should render while ${key} loads`);
    });
  }

  it("reports loading when console is complete but another section is still loading", () => {
    const html = render(createState({ console: "available", tests: "loading" }));

    assert.equal(isGloballyLoading(html), true);
    assert.match(html, /role="progressbar"/);
  });

  it("reports idle once every section has finished loading", () => {
    const html = render(
      createState({
        tests: "available",
        parameters: "empty",
        changesets: "unavailable",
        stages: "error",
        console: "tooLarge"
      })
    );

    assert.equal(isGloballyLoading(html), false);
    assert.doesNotMatch(html, /role="progressbar"/);
  });
});
