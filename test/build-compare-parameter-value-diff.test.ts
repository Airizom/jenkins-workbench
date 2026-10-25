import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { diffParameterValues } from "../src/panels/buildCompare/webview/components/buildCompare/parameterValueDiff";
import { ParameterDiffSection } from "../src/panels/buildCompare/webview/components/buildCompare/ParameterDiffSection";

describe("diffParameterValues", () => {
  it("marks only the words that differ between option strings", () => {
    const diff = diffParameterValues("-DskipITs -Xmx2g -XX:+UseG1GC", "-Xmx4g -XX:+UseG1GC");

    assert.deepEqual(diff, {
      baseline: [
        { text: "-DskipITs", changed: true },
        { text: " ", changed: false },
        { text: "-Xmx2g", changed: true },
        { text: " -XX:+UseG1GC", changed: false }
      ],
      target: [
        { text: "-Xmx4g", changed: true },
        { text: " -XX:+UseG1GC", changed: false }
      ]
    });
  });

  it("keeps the exact text of each side", () => {
    const baseline = "a  b\tc d";
    const target = "a b  x d";
    const diff = diffParameterValues(baseline, target);

    assert.ok(diff);
    assert.equal(diff.baseline.map((segment) => segment.text).join(""), baseline);
    assert.equal(diff.target.map((segment) => segment.text).join(""), target);
  });

  it("skips single-word values and values that share no words", () => {
    assert.equal(diffParameterValues("20.11.0", "22.4.1"), undefined);
    assert.equal(diffParameterValues("", "x"), undefined);
    assert.equal(diffParameterValues("a b", "c d"), undefined);
  });

  it("skips values too long to diff cheaply", () => {
    const long = Array.from({ length: 300 }, (_, index) => `w${index}`).join(" ");
    assert.equal(diffParameterValues(long, `${long} extra`), undefined);
  });
});

describe("ParameterDiffSection", () => {
  it("highlights changed words as deletions and insertions", () => {
    const html = renderToStaticMarkup(
      createElement(ParameterDiffSection, {
        section: {
          status: "available",
          summaryLabel: "1 parameter differs",
          unchangedCount: 0,
          items: [
            {
              name: "MAVEN_OPTS",
              changeType: "changed",
              baselineValue: "-Xmx2g -Dfoo",
              targetValue: "-Xmx4g -Dfoo"
            },
            { name: "NODE", changeType: "changed", baselineValue: "20", targetValue: "22" }
          ]
        }
      })
    );

    assert.match(html, /<del data-change="removed" class="bc-diff-token">-Xmx2g<\/del>/);
    assert.match(html, /<ins data-change="added" class="bc-diff-token">-Xmx4g<\/ins>/);
    assert.equal(html.match(/bc-diff-token/g)?.length, 2);
  });
});
