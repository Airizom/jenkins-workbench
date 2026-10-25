import assert from "node:assert/strict";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  describePendingInputParameter,
  PendingInputsSection
} from "../src/panels/buildDetails/webview/components/buildDetails/PendingInputsSection";
import type { PendingInputProcessingAction } from "../src/panels/buildDetails/webview/state/buildDetailsState";

function invokeInputActions(node: ReactNode): void {
  for (const child of Children.toArray(node)) {
    if (
      !isValidElement<{
        children?: ReactNode;
        action?: PendingInputProcessingAction;
        onAction?: (action: PendingInputProcessingAction) => void;
      }>(child)
    ) {
      continue;
    }
    if (child.props.action) {
      child.props.onAction?.(child.props.action);
    }
    invokeInputActions(child.props.children);
  }
}

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
    // Parameters are chosen in VS Code prompts, so Approve takes an ellipsis.
    assert.match(html, />Approve…</);
    assert.match(html, /You choose these values when you approve\./);
    assert.match(html, /Reject/);
  });

  it("keeps a plain Approve label for inputs without parameters", () => {
    const html = renderToStaticMarkup(
      createElement(PendingInputsSection, {
        pendingInputs: [
          { id: "go", message: "Proceed?", submitterLabel: "", parametersLabel: "", parameters: [] }
        ],
        onApprove: () => undefined,
        onReject: () => undefined
      })
    );

    assert.match(html, />Approve</);
    assert.doesNotMatch(html, /Approve…/);
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

  it("keeps both actions disabled while the extension is handling a request", () => {
    const html = renderToStaticMarkup(
      createElement(PendingInputsSection, {
        pendingInputs: [
          {
            id: "deploy",
            message: "Deploy to production?",
            submitterLabel: "",
            parametersLabel: "",
            parameters: []
          }
        ],
        processingActions: { deploy: "reject" },
        onApprove: () => undefined,
        onReject: () => undefined
      })
    );

    assert.equal(html.match(/<button[^>]*disabled=""/g)?.length, 2);
    assert.match(html, /Rejecting…/);
    assert.match(html, /aria-busy="true"/);
  });

  for (const id of ["constructor", "toString", "__proto__"]) {
    it(`ignores inherited processing entries for ${id}`, () => {
      const approved: string[] = [];
      const rejected: string[] = [];
      const section = PendingInputsSection({
        pendingInputs: [
          { id, message: "Continue?", submitterLabel: "", parametersLabel: "", parameters: [] }
        ],
        processingActions: {},
        onApprove: (inputId) => approved.push(inputId),
        onReject: (inputId) => rejected.push(inputId)
      });
      const html = renderToStaticMarkup(section);

      assert.equal(html.match(/<button/g)?.length, 2);
      assert.doesNotMatch(html, /disabled=""/);
      assert.match(html, /aria-busy="false"/);
      invokeInputActions(section);
      assert.deepEqual(approved, [id]);
      assert.deepEqual(rejected, [id]);
    });

    for (const action of ["approve", "reject"] as const) {
      it(`blocks both actions for an own ${action} entry for ${id}`, () => {
        const section = PendingInputsSection({
          pendingInputs: [
            { id, message: "Continue?", submitterLabel: "", parametersLabel: "", parameters: [] }
          ],
          processingActions: { [id]: action },
          onApprove: () => assert.fail("Approve must be blocked while processing"),
          onReject: () => assert.fail("Reject must be blocked while processing")
        });
        const html = renderToStaticMarkup(section);

        assert.equal(html.match(/<button[^>]*disabled=""/g)?.length, 2);
        assert.match(html, /aria-busy="true"/);
        assert.ok(html.includes(action === "approve" ? "Approving…" : "Rejecting…"));
        invokeInputActions(section);
      });
    }
  }
});
