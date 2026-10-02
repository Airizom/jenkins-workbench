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
    buildNumberLabel: displayName,
    jobDisplayName: "demo",
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
      otherChanges: [],
      ambiguousTests: [],
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

  it("names the shared job once and keeps both build numbers visible", () => {
    const html = render(createState({}));

    assert.match(html, /<h1[^>]*title="#1 vs #2"[^>]*>/);
    assert.equal(html.split(">demo<").length - 1, 1);
    assert.match(html, />#1</);
    assert.match(html, />#2</);
  });

  it("labels each nav chip with its section title and a visible status", () => {
    const html = render(
      createState({ tests: "unavailable", parameters: "empty", changesets: "error" })
    );

    assert.match(html, /Tests<span[^>]*>·<\/span><span[^>]*>n\/a</);
    assert.match(html, /Parameters<span[^>]*>·<\/span><span[^>]*>no changes</);
    assert.match(html, /Commits<span[^>]*>·<\/span><span[^>]*>error</);
  });

  it("nests each expandable section's disclosure button inside its heading", () => {
    const html = render(createState({}));

    // Tests always has per-build counts to expand.
    assert.match(
      html,
      /<h3[^>]*><button[^>]*aria-describedby="[^"]+"[^>]*>.*?Tests<\/span><\/button><\/h3>/
    );
    // Sections with nothing to show render a plain heading instead of a dead toggle.
    for (const title of ["Parameters", "Commits", "Stages", "Console"]) {
      assert.match(html, new RegExp(`<h3[^>]*><span[^>]*>${title}</span></h3>`));
    }
  });

  it("collapses sections without differences by default", () => {
    const html = render(createState({ tests: "empty" }));

    assert.match(html, /<h3[^>]*><button[^>]*aria-expanded="false"[^>]*>.*?Tests<\/span>/);
    assert.doesNotMatch(html, /border-dashed[^"]*"[^>]*>.*?No changed parameters/);
  });

  it("keeps Refresh and Swap available while only the console scan runs", () => {
    const html = render(createState({ console: "loading" }));

    assert.match(html, /<button[^>]*aria-label="Refresh comparison"[^>]*>/);
    assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*aria-label="Refresh comparison"/);
    assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Swap sides</);
    assert.equal(isGloballyLoading(html), true);
  });

  it("disables Refresh and Swap while other sections are still loading", () => {
    const html = render(createState({ tests: "loading" }));

    assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Refresh comparison"/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Swap sides</);
  });

  it("shows a section error's detail once and names it in the summary list", () => {
    const state = createState({ tests: "error" });
    state.tests = {
      ...state.tests,
      summaryLabel: "Test comparison unavailable",
      detail: "Target test report: Request failed with status 500."
    };
    const html = render(state);

    assert.equal(html.split("Request failed with status 500.").length - 1, 1);
    assert.match(html, /Tests: Test comparison unavailable/);
  });

  it("offers to open either build when the console is too large to compare", () => {
    const html = render(createState({ console: "tooLarge" }));

    assert.match(html, />Open baseline build #1</);
    assert.match(html, />Open target build #2</);
    assert.doesNotMatch(html, /did not produce a snippet/);
  });

  it("labels build cards by start time and names their details buttons per side", () => {
    const html = render(createState({}));

    assert.match(html, />Started</);
    assert.doesNotMatch(html, />Completed</);
    assert.match(html, /aria-label="Open build details for baseline build #1"/);
    assert.match(html, /aria-label="Open build details for target build #2"/);
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
