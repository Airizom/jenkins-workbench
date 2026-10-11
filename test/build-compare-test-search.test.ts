import assert from "node:assert/strict";
import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, it, vi } from "vitest";
import type { JenkinsTestReport } from "../src/jenkins/types";
import { buildTestsSection } from "../src/panels/buildCompare/BuildCompareTestsSection";
import { TEST_DIFF_SEARCH_MIN_ITEMS } from "../src/panels/buildCompare/webview/components/buildCompare/testDiff/testDiffModel";

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
});

it("keeps an active test search visible and clearable after the result count drops", async () => {
  let query = "";
  const actualReact = await vi.importActual<typeof import("react")>("react");
  // Preserve the section's query across renders; child state stays at its initial value.
  vi.doMock("react", () => ({
    ...actualReact,
    useState: (initial: unknown) =>
      initial === "" ? [query, (next: string) => (query = next)] : [initial, () => undefined]
  }));
  const { TestDiffSection } = await import(
    "../src/panels/buildCompare/webview/components/buildCompare/TestDiffSection"
  );
  function render(count: number) {
    const report: JenkinsTestReport = {
      suites: [
        {
          name: "Suite",
          cases: Array.from({ length: count }, (_, index) => ({
            name: `t${index}`,
            status: "FAILED"
          }))
        }
      ]
    };
    const section = buildTestsSection(
      { status: "available", value: { suites: [] } },
      { status: "available", value: report }
    );
    const tree = TestDiffSection({ section });
    const search = Children.toArray(tree.props.children).find(
      (child) =>
        isValidElement<{ onQueryChange?: (query: string) => void }>(child) &&
        typeof child.props.onQueryChange === "function"
    );
    return { html: renderToStaticMarkup(tree), search };
  }
  function changeQuery(search: unknown, next: string) {
    assert.ok(isValidElement<{ onQueryChange: (query: string) => void }>(search));
    search.props.onQueryChange(next);
  }

  changeQuery(render(TEST_DIFF_SEARCH_MIN_ITEMS).search, " T0 ");
  const filtered = render(2);
  assert.match(filtered.html, /aria-label="Search changed tests by suite, class, or name"/);
  assert.match(filtered.html, /value=" T0 "/);
  assert.match(filtered.html, /1 of 2 changed tests match/);
  assert.match(filtered.html, />t0<\/p>/);
  assert.doesNotMatch(filtered.html, />t1<\/p>/);

  changeQuery(filtered.search, "");
  const cleared = render(2);
  assert.match(cleared.html, />t0<\/p>/);
  assert.match(cleared.html, />t1<\/p>/);
  assert.doesNotMatch(cleared.html, /Search changed tests/);
});
