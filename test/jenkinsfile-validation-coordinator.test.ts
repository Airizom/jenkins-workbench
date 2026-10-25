import assert from "node:assert/strict";
import { beforeEach, it, vi } from "vitest";
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
const output: string[] = [];

class TestCancellationTokenSource {
  private readonly emitter = new vscodeStub.EventEmitter<void>();
  readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: this.emitter.event
  };
  readonly dispose = vi.fn();

  cancel(): void {
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  }
}

let activeDocument: vscode.TextDocument | undefined;
let progressCancellation: TestCancellationTokenSource;
const showWarningMessage = vi.fn();

beforeEach(() => {
  published.length = 0;
  output.length = 0;
  activeDocument = undefined;
  progressCancellation = new TestCancellationTokenSource();
  showWarningMessage.mockClear();
});

vi.doMock("vscode", () => ({
  ...vscodeStub,
  ProgressLocation: { Notification: 15 },
  CancellationTokenSource: TestCancellationTokenSource,
  languages: {
    createDiagnosticCollection: () => ({
      set: (_uri: vscode.Uri, diagnostics: vscodeStub.Diagnostic[]) => published.push(diagnostics),
      delete: () => undefined,
      clear: () => undefined,
      dispose: () => undefined
    })
  },
  window: {
    get activeTextEditor() {
      return activeDocument ? { document: activeDocument } : undefined;
    },
    withProgress: (
      _options: unknown,
      task: (progress: unknown, token: vscode.CancellationToken) => Promise<void>
    ) => task({}, progressCancellation.token),
    showWarningMessage,
    createOutputChannel: () => ({
      appendLine: (line: string) => output.push(line),
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
const { JenkinsfileEnvironmentResolver } = await import(
  "../src/validation/JenkinsfileEnvironmentResolver"
);

it.each(
  (["environment", "client", "request"] as const).flatMap((stage) =>
    (["resolve", "reject"] as const).map((completion) => ({ stage, completion }))
  )
)(
  "settles canceled command progress while $stage is pending and ignores late $completion",
  async ({ stage, completion }) => {
    const document = {
      uri: vscodeStub.Uri.file("/workspace/Jenkinsfile"),
      version: 1,
      getText: () => "pipeline { agent any }",
      isClosed: false
    } as vscode.TextDocument;
    activeDocument = document;
    const environment: JenkinsEnvironmentRef = {
      environmentId: "env",
      scope: "workspace",
      url: "https://jenkins.example/"
    };
    let release!: () => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    const resolveEnvironment = vi.fn(async () => {
      if (stage === "environment") await pending;
      return environment;
    });
    const validate = vi.fn(async () => {
      if (stage === "request") await pending;
      return "WorkflowScript: 1: Missing required section 'stages' @ line 1";
    });
    const getClient = vi.fn(async () => {
      if (stage === "client") await pending;
      return { validateDeclarativeJenkinsfile: validate };
    });
    const stateStore = new JenkinsfileValidationStateStore();
    const statusBar = { setValidating: vi.fn(), refresh: vi.fn() };
    const coordinator = new JenkinsfileValidationCoordinator(
      { getClient } as never,
      { resolveForDocument: resolveEnvironment } as never,
      stateStore,
      statusBar as never,
      { matches: () => true } as never,
      { enabled: true, runOnSave: false, changeDebounceMs: 0, filePatterns: ["Jenkinsfile"] }
    );

    try {
      let settled = false;
      const command = coordinator.validateActiveEditor().then(() => {
        settled = true;
      });
      const pendingCall = { environment: resolveEnvironment, client: getClient, request: validate }[
        stage
      ];
      await vi.waitFor(() => assert.equal(pendingCall.mock.calls.length, 1));

      progressCancellation.cancel();
      await vi.waitFor(() => assert.equal(settled, true), { timeout: 200 });
      await command;
      assert.equal(statusBar.refresh.mock.calls.length, 1);

      if (completion === "resolve") {
        release();
      } else {
        fail(new Error("Late validation failure"));
      }
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(validate.mock.calls.length, stage === "request" ? 1 : 0);
      assert.equal(published.length, 0);
      assert.equal(output.length, 0);
      assert.equal(showWarningMessage.mock.calls.length, 0);
      assert.equal(stateStore.getValidationState(document), undefined);
      assert.equal(stateStore.getCachedValidation(document), undefined);
    } finally {
      release();
      coordinator.dispose();
    }
  }
);

it.each(["save", "open"] as const)(
  "reports selection persistence failures during automatic %s validation",
  async (reason) => {
    const document = {
      uri: vscodeStub.Uri.file("/workspace/Jenkinsfile"),
      version: 1,
      getText: () => "pipeline { agent any }",
      lineCount: 1,
      lineAt: () => ({ text: "pipeline { agent any }" }),
      isClosed: false
    } as unknown as vscode.TextDocument;
    const update = vi.fn(async () => {
      throw new Error("Selection could not be saved");
    });
    const resolver = new JenkinsfileEnvironmentResolver(
      { workspaceState: { get: () => undefined, update } } as never,
      {
        listEnvironmentsWithScope: async () => [
          { id: "env", scope: "workspace", url: "https://jenkins.example/" }
        ]
      } as never
    );
    const getClient = vi.fn();
    const stateStore = new JenkinsfileValidationStateStore();
    stateStore.updateCachedValidation(document, { hash: "previous", environmentKey: "env" });
    let validating = false;
    const statusBar = {
      setValidating: () => {
        validating = true;
      },
      refresh: () => {
        validating = false;
      }
    };
    const coordinator = new JenkinsfileValidationCoordinator(
      { getClient } as never,
      resolver,
      stateStore,
      statusBar as never,
      { matches: () => true } as never,
      { enabled: true, runOnSave: true, changeDebounceMs: 0, filePatterns: ["Jenkinsfile"] }
    );
    coordinator.start();

    try {
      (reason === "save" ? saves : opens).fire(document);
      assert.equal(validating, true);
      await vi.waitFor(() => assert.equal(published.length, 1));

      const message = "Environment resolution failed: Selection could not be saved";
      assert.equal(validating, false);
      assert.equal(update.mock.calls.length, 1);
      assert.equal(getClient.mock.calls.length, 0);
      assert.equal(published[0][0].message, message);
      assert.equal(published[0][0].severity, vscodeStub.DiagnosticSeverity.Warning);
      assert.deepEqual(stateStore.getValidationState(document), {
        kind: "request-failed",
        environment: undefined,
        message
      });
      assert.equal(stateStore.getCachedValidation(document), undefined);
      assert.ok(output.includes(message));
    } finally {
      coordinator.dispose();
    }
  }
);

it.each(["save", "open", "change", "revalidate"] as const)(
  "handles unexpected rejections from %s validation",
  async (reason) => {
    const document = {
      uri: vscodeStub.Uri.file("/workspace/Jenkinsfile"),
      version: 1,
      getText: () => {
        throw new Error("Document unavailable");
      },
      isClosed: false
    } as unknown as vscode.TextDocument;
    const statusBar = { refresh: vi.fn() };
    const stateStore = new JenkinsfileValidationStateStore();
    const completeChangeValidation = vi.spyOn(stateStore, "completeChangeValidation");
    const coordinator = new JenkinsfileValidationCoordinator(
      {} as never,
      {} as never,
      stateStore,
      statusBar as never,
      { matches: () => true } as never,
      { enabled: true, runOnSave: true, changeDebounceMs: 0, filePatterns: ["Jenkinsfile"] }
    );
    coordinator.start();

    try {
      if (reason === "revalidate") {
        coordinator.revalidateDocument(document);
      } else if (reason === "change") {
        changes.fire({ document, contentChanges: [{}] });
      } else {
        (reason === "save" ? saves : opens).fire(document);
      }
      await vi.waitFor(() => {
        assert.ok(output.includes("Jenkinsfile validation failed: Document unavailable"));
      });
      assert.equal(statusBar.refresh.mock.calls.length, 1);
      if (reason === "change") {
        assert.equal(completeChangeValidation.mock.calls.length, 1);
        const tokenSource = completeChangeValidation.mock.calls[0][1];
        assert.equal(
          (tokenSource as unknown as TestCancellationTokenSource).dispose.mock.calls.length,
          1
        );
      }
    } finally {
      coordinator.dispose();
    }
  }
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

it("skips a closed document when the validation request settles", async () => {
  let isClosed = false;
  const document = {
    uri: vscodeStub.Uri.file("/workspace/Jenkinsfile"),
    version: 1,
    getText: () => "pipeline { agent any }",
    get isClosed() {
      return isClosed;
    }
  } as vscode.TextDocument;
  activeDocument = document;
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
  const statusBar = { setValidating: vi.fn(), refresh: vi.fn(), clear: vi.fn() };
  const coordinator = new JenkinsfileValidationCoordinator(
    { getClient: async () => ({ validateDeclarativeJenkinsfile: validate }) } as never,
    { resolveForDocument: async () => environment } as never,
    stateStore,
    statusBar as never,
    { matches: () => true } as never,
    { enabled: true, runOnSave: false, changeDebounceMs: 0, filePatterns: ["Jenkinsfile"] }
  );

  try {
    const command = coordinator.validateActiveEditor();
    await vi.waitFor(() => assert.equal(validate.mock.calls.length, 1));
    isClosed = true;
    resolveResponse("WorkflowScript: 1: Missing required section 'stages' @ line 1");
    await command;

    assert.equal(published.length, 0);
    assert.equal(output.length, 0);
    assert.equal(showWarningMessage.mock.calls.length, 0);
    assert.equal(stateStore.getValidationState(document), undefined);
    assert.equal(stateStore.getCachedValidation(document), undefined);
  } finally {
    coordinator.dispose();
  }
});
