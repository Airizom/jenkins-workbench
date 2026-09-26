import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { BuildCompareStageDiffItem } from "../src/panels/buildCompare/shared/BuildCompareContracts";
import { StageTimingSection } from "../src/panels/buildCompare/webview/components/buildCompare/StageTimingSection";

function render(items: BuildCompareStageDiffItem[]): string {
  return renderToStaticMarkup(
    createElement(StageTimingSection, {
      section: { status: "available", summaryLabel: "Stages", items }
    })
  );
}

describe("StageTimingSection", () => {
  it("renders stages as a table with one header row", () => {
    const html = render([
      {
        key: "build",
        name: "Build",
        changeType: "matched",
        baselineStatusLabel: "Success",
        targetStatusLabel: "Success",
        baselineStatusClass: "success",
        targetStatusClass: "success",
        baselineDurationLabel: "41s",
        targetDurationLabel: "48s",
        deltaLabel: "+7s",
        deltaDirection: "slower"
      }
    ]);

    assert.equal(html.match(/<thead/g)?.length, 1);
    assert.match(html, /<th scope="row"[^>]*>.*Build/);
    assert.match(html, /\+7s/);
    assert.match(html, /\(slower\)/);
    assert.doesNotMatch(html, /status regressed/);
  });

  it("flags stages whose status regressed and marks added or removed stages", () => {
    const html = render([
      {
        key: "tests",
        name: "Tests",
        changeType: "matched",
        baselineStatusLabel: "Success",
        targetStatusLabel: "Failed",
        baselineStatusClass: "success",
        targetStatusClass: "failure"
      },
      {
        key: "legacy",
        name: "Legacy",
        changeType: "removed",
        baselineStatusLabel: "Success",
        baselineStatusClass: "success"
      }
    ]);

    assert.match(html, /bg-failure-surface/);
    assert.match(html, /status regressed/);
    assert.match(html, /Removed/);
    assert.match(html, /Not present/);
  });

  it("only flags stages whose status got worse", () => {
    const matched = (
      key: string,
      baselineStatusClass: string,
      targetStatusClass: string
    ): BuildCompareStageDiffItem => ({
      key,
      name: key,
      changeType: "matched",
      baselineStatusLabel: baselineStatusClass,
      targetStatusLabel: targetStatusClass,
      baselineStatusClass,
      targetStatusClass
    });

    assert.doesNotMatch(render([matched("improved", "failure", "unstable")]), /status regressed/);
    assert.doesNotMatch(render([matched("same", "failure", "failure")]), /status regressed/);
    assert.match(render([matched("worse", "unstable", "failure")]), /status regressed/);
  });
});
