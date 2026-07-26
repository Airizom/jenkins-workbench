import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsfileMatcher } from "../src/validation/JenkinsfileMatcher";

const activeEditorListeners: Array<(editor?: vscode.TextEditor) => void> = [];
let activeTextEditor: vscode.TextEditor | undefined;
const statusBarItem = {
  text: "",
  color: undefined as unknown,
  tooltip: undefined as unknown,
  command: undefined as unknown,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn()
};

vi.doMock("vscode", () => ({
  StatusBarAlignment: { Right: 1 },
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  window: {
    get activeTextEditor() {
      return activeTextEditor;
    },
    createStatusBarItem: () => statusBarItem,
    onDidChangeActiveTextEditor: (listener: (editor?: vscode.TextEditor) => void) => {
      activeEditorListeners.push(listener);
      return { dispose: () => undefined };
    }
  }
}));

const [{ JenkinsfileValidationStateStore }, { JenkinsfileValidationStatusBar }] = await Promise.all(
  [
    import("../src/validation/JenkinsfileValidationStateStore"),
    import("../src/validation/JenkinsfileValidationStatusBar")
  ]
);

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

describe("JenkinsfileValidationStatusBar", () => {
  it("renders persistent states from the canonical store and keeps validating transient", () => {
    const firstDocument = createDocument("file:///workspace/Jenkinsfile");
    const secondDocument = createDocument("file:///workspace/Jenkinsfile.other");
    const stateStore = new JenkinsfileValidationStateStore();
    stateStore.setResultState(firstDocument, 0, environment);
    stateStore.setRequestFailedState(secondDocument, "Jenkins is unavailable", environment);
    activeTextEditor = { document: firstDocument } as vscode.TextEditor;

    const matcher = { matches: () => true } as unknown as JenkinsfileMatcher;
    const statusBar = new JenkinsfileValidationStatusBar(matcher, stateStore);

    assert.equal(statusBarItem.text, "$(check) Valid");

    activeTextEditor = { document: secondDocument } as vscode.TextEditor;
    activeEditorListeners[0](activeTextEditor);
    assert.equal(statusBarItem.text, "$(warning) Validation unavailable");

    statusBar.setValidating(secondDocument, environment);
    assert.equal(statusBarItem.text, "$(sync~spin) Validating...");

    stateStore.setResultState(secondDocument, 2, environment, true);
    statusBar.refresh(secondDocument);
    assert.equal(statusBarItem.text, "$(error) Errors: 2 (stale)");
    assert.equal((statusBarItem.color as { id: string }).id, "statusBarItem.inactiveForeground");

    statusBar.dispose();
  });
});

function createDocument(uri: string): vscode.TextDocument {
  return {
    uri: {
      toString: () => uri
    }
  } as vscode.TextDocument;
}
