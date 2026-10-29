import assert from "node:assert/strict";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  describePendingInputParameter,
  PendingInputsSection
} from "../src/panels/buildDetails/webview/components/buildDetails/PendingInputsSection";
import type { PendingInputViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import type { PendingInputProcessingAction } from "../src/panels/buildDetails/webview/state/buildDetailsState";

const BROWSER_APPROVE_TITLE = "Open the Jenkins input page to enter these values and approve";

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

function clickBrowserApprove(node: ReactNode): number {
  let clicks = 0;
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; title?: string; onClick?: () => void }>(child)) {
      continue;
    }
    if (child.props.title === BROWSER_APPROVE_TITLE) {
      child.props.onClick?.();
      clicks += 1;
    }
    clicks += clickBrowserApprove(child.props.children);
  }
  return clicks;
}

const browserOnlyInput: PendingInputViewModel = {
  id: "release",
  message: "Upload the release notes?",
  submitterLabel: "",
  parametersLabel: "Parameters: NOTES (File), REGION (Choice), TAG (GitParameterDefinition)",
  parameters: [
    { name: "NOTES", kind: "File", requiresBrowser: true },
    { name: "REGION", kind: "Choice", choices: ["us-east-1"] },
    { name: "TAG", kind: "GitParameterDefinition", requiresBrowser: true }
  ],
  requiresBrowser: true
};

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
    assert.equal(
      describePendingInputParameter({ name: "NOTES", kind: "File", requiresBrowser: true }),
      "Entered on the Jenkins input page."
    );
    assert.equal(
      describePendingInputParameter({
        name: "TAG",
        kind: "GitParameterDefinition",
        description: "Tag to deploy",
        requiresBrowser: true
      }),
      "Tag to deploy"
    );
  });

  it("swaps Approve for Approve in Jenkins when a parameter needs the browser", () => {
    const html = renderToStaticMarkup(
      createElement(PendingInputsSection, {
        pendingInputs: [browserOnlyInput],
        onApprove: () => undefined,
        onReject: () => undefined,
        onOpenInJenkins: () => undefined
      })
    );

    assert.match(html, />Approve in Jenkins</);
    assert.doesNotMatch(html, />Approve…</);
    assert.ok(html.includes(`title="${BROWSER_APPROVE_TITLE}"`));
    assert.match(html, />Reject</);
    assert.match(
      html,
      /Approve this input in Jenkins: NOTES, TAG can&#x27;t be entered in VS Code\./
    );
    assert.doesNotMatch(html, /You choose these values when you approve\./);
    // Only the browser-only parameters carry the badge.
    assert.equal(html.match(/>Browser</g)?.length, 2);
    assert.match(html, /<dt[^>]*>.*NOTES.*File.*Browser/);
    assert.match(html, /Entered on the Jenkins input page\./);
  });

  it("opens Jenkins without marking the input as processing", () => {
    const opened: string[] = [];
    const section = PendingInputsSection({
      pendingInputs: [browserOnlyInput],
      processingActions: {},
      onApprove: () => assert.fail("Browser-only inputs must not approve from VS Code"),
      onReject: () => undefined,
      onOpenInJenkins: (inputId) => opened.push(inputId)
    });

    assert.equal(clickBrowserApprove(section), 1);
    assert.deepEqual(opened, ["release"]);
  });

  it("disables Approve in Jenkins while a rejection is processing", () => {
    const html = renderToStaticMarkup(
      createElement(PendingInputsSection, {
        pendingInputs: [browserOnlyInput],
        processingActions: { release: "reject" },
        onApprove: () => undefined,
        onReject: () => undefined,
        onOpenInJenkins: () => undefined
      })
    );

    assert.equal(html.match(/<button[^>]*disabled=""/g)?.length, 2);
    assert.match(html, /Rejecting…/);
    assert.match(html, />Approve in Jenkins</);
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
            parameters: [{ name: "REGION", kind: "Choice", choices: ["us-east-1"] }],
            requiresBrowser: false
          }
        ],
        onApprove: () => undefined,
        onReject: () => undefined,
        onOpenInJenkins: () => undefined
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
          {
            id: "go",
            message: "Proceed?",
            submitterLabel: "",
            parametersLabel: "",
            parameters: [],
            requiresBrowser: false
          }
        ],
        onApprove: () => undefined,
        onReject: () => undefined,
        onOpenInJenkins: () => undefined
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
        onReject: () => undefined,
        onOpenInJenkins: () => undefined
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
            parameters: [],
            requiresBrowser: false
          }
        ],
        processingActions: { deploy: "reject" },
        onApprove: () => undefined,
        onReject: () => undefined,
        onOpenInJenkins: () => undefined
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
          {
            id,
            message: "Continue?",
            submitterLabel: "",
            parametersLabel: "",
            parameters: [],
            requiresBrowser: false
          }
        ],
        processingActions: {},
        onApprove: (inputId) => approved.push(inputId),
        onReject: (inputId) => rejected.push(inputId),
        onOpenInJenkins: () => assert.fail("Inputs VS Code can submit must not open Jenkins")
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
            {
              id,
              message: "Continue?",
              submitterLabel: "",
              parametersLabel: "",
              parameters: [],
              requiresBrowser: false
            }
          ],
          processingActions: { [id]: action },
          onApprove: () => assert.fail("Approve must be blocked while processing"),
          onReject: () => assert.fail("Reject must be blocked while processing"),
          onOpenInJenkins: () => assert.fail("Inputs VS Code can submit must not open Jenkins")
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
