import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import * as vscodeStub from "./helpers/vscodeStub";

const changes = new vscodeStub.EventEmitter<{
  document: vscode.TextDocument;
  contentChanges: [object];
}>();
const saves = new vscodeStub.EventEmitter<vscode.TextDocument>();
const opens = new vscodeStub.EventEmitter<vscode.TextDocument>();
const closes = new vscodeStub.EventEmitter<vscode.TextDocument>();
const published: vscodeStub.Diagnostic[][] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  languages: {
    createDiagnosticCollection: () => ({
      set: (_uri: vscode.Uri, diagnostics: vscodeStub.Diagnostic[]) => published.push(diagnostics),
      delete: () => undefined,
      clear: () => undefined,
      dispose: () => undefined
    })
  },
  window: {
    createOutputChannel: () => ({
      appendLine: () => undefined,
      show: () => undefined,
      dispose: () => undefined
    })
  },
  workspace: {
    onDidSaveTextDocument: saves.event,
    onDidOpenTextDocument: opens.event,
    onDidChangeTextDocument: changes.event,
    onDidCloseTextDocument: closes.event,
    getWorkspaceFolder: () => undefined
  }
}));

const { JenkinsfileValidationCoordinator } = await import(
  "../src/validation/JenkinsfileValidationCoordinator"
);
const { JenkinsfileValidationStateStore } = await import(
  "../src/validation/JenkinsfileValidationStateStore"
);

it("keeps the prior result stale when text changes during a validation request", async () => {
  let version = 1;
  let text = "pipeline { agent any }";
  const document = {
    uri: vscodeStub.Uri.file("/workspace/Jenkinsfile"),
    get version() {
      return version;
    },
    getText: () => text,
    isClosed: false
  } as vscode.TextDocument;
  const environment: JenkinsEnvironmentRef = {
    environmentId: "env",
    scope: "workspace",
    url: "https://jenkins.example/"
  };
  let resolveResponse!: (value: string) => void;
  const response = new Promise<string>((resolve) => {
    resolveResponse = resolve;
  });
  const validate = vi.fn(() => response);
  const stateStore = new JenkinsfileValidationStateStore();
  stateStore.setResultState(document, 1, environment);
  const statusBar = { setValidating: vi.fn(), refresh: vi.fn(), clear: vi.fn() };
  const coordinator = new JenkinsfileValidationCoordinator(
    { getClient: async () => ({ validateDeclarativeJenkinsfile: validate }) } as never,
    { resolveForDocument: async () => environment } as never,
    stateStore,
    statusBar as never,
    { matches: () => true } as never,
    { enabled: true, runOnSave: false, changeDebounceMs: 0, filePatterns: ["Jenkinsfile"] }
  );
  coordinator.start();

  coordinator.revalidateDocument(document);
  await vi.waitFor(() => assert.equal(validate.mock.calls.length, 1));
  version += 1;
  text = "pipeline { agent none }";
  changes.fire({ document, contentChanges: [{}] });
  assert.deepEqual(stateStore.getValidationState(document), {
    kind: "result",
    errorCount: 1,
    environment,
    stale: true
  });

  resolveResponse("WorkflowScript: 1: Missing required section 'stages' @ line 1");
  await vi.waitFor(() => assert.equal(statusBar.refresh.mock.calls.length, 2));

  assert.equal(published.length, 0);
  assert.deepEqual(stateStore.getValidationState(document), {
    kind: "result",
    errorCount: 1,
    environment,
    stale: true
  });
  assert.equal(stateStore.getCachedValidation(document), undefined);
  coordinator.dispose();
});
