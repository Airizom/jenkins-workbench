import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  describePendingInputParameter,
  PendingInputsSection
} from "../src/panels/buildDetails/webview/components/buildDetails/PendingInputsSection";

describe("PendingInputsSection", () => {
  it("describes parameter descriptions, choices, and defaults", () => {
    assert.equal(
      describePendingInputParameter({
        name: "REGION",
        kind: "Choice",
        description: "Target region",
        choices: ["us-east-1", "eu-west-1"],
        defaultValue: "us-east-1"
      }),
      "Target region · Choices: us-east-1, eu-west-1 · Default: us-east-1"
    );
    assert.equal(
      describePendingInputParameter({ name: "TAGS", kind: "Multi", defaultValue: ["a", "b"] }),
      "Default: a, b"
    );
    assert.equal(
      describePendingInputParameter({ name: "NOTIFY", kind: "Boolean", defaultValue: false }),
      "Default: false"
    );
    assert.equal(
      describePendingInputParameter({ name: "NOTE", kind: "String", defaultValue: "" }),
      "You will be prompted for a value."
    );
  });

  it("renders the prompt, submitter, parameters, and actions", () => {
    const html = renderToStaticMarkup(
      createElement(PendingInputsSection, {
        pendingInputs: [
          {
            id: "deploy",
            message: "Deploy to production?",
            submitterLabel: "Submitter: release-managers",
            parametersLabel: "Parameters: REGION (Choice)",
            parameters: [{ name: "REGION", kind: "Choice", choices: ["us-east-1"] }]
          }
        ],
        onApprove: () => undefined,
        onReject: () => undefined
      })
    );

    assert.match(html, /Deploy to production\?/);
    assert.match(html, /Submitter: release-managers/);
    assert.doesNotMatch(html, /Submitter: Submitter:/);
    assert.match(html, /<dt[^>]*>.*REGION.*Choice/);
    assert.match(html, /Choices: us-east-1/);
    assert.match(html, /Approve/);
    assert.match(html, /Reject/);
  });

  it("renders nothing without pending inputs", () => {
    const html = renderToStaticMarkup(
      createElement(PendingInputsSection, {
        pendingInputs: [],
        onApprove: () => undefined,
        onReject: () => undefined
      })
    );
    assert.equal(html, "");
  });
});
