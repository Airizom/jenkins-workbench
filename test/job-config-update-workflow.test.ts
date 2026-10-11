import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

type UriLike = { toString(): string };

const targetUri: UriLike = {
  toString: () => "job-config-draft:/demo/config.xml"
};

let documentText = "<project><description>edited</description></project>";
let remoteXml = "<project><description>original</description></project>";
let warningChoice: string | undefined;
let diagnostics = [{ severity: 1 }];
let quickPickCalls = 0;
let quickPickSelections: boolean[] = [];
const informationMessages: string[] = [];

const vscodeMock = {
  DiagnosticSeverity: {
    Error: 0
  },
  ProgressLocation: {
    Notification: 15
  },
  window: {
    activeTextEditor: undefined,
    showInformationMessage: async (message: string) => {
      informationMessages.push(message);
      return undefined;
    },
    showErrorMessage: async () => undefined,
    showQuickPick: async (items: unknown[]) => {
      quickPickCalls += 1;
      return quickPickSelections.shift() === false ? items[1] : items[0];
    },
    showWarningMessage: vi.fn(async () => warningChoice),
    withProgress: async (_options: unknown, task: () => Promise<unknown>) => task()
  },
  workspace: {
    openTextDocument: async () => ({
      getText: () => documentText
    }),
    onDidCloseTextDocument: () => ({ dispose: () => undefined })
  },
  languages: {
    getDiagnostics: () => diagnostics,
    onDidChangeDiagnostics: () => ({ dispose: () => undefined }),
    setTextDocumentLanguage: async () => undefined
  },
  Disposable: class {
    constructor(private readonly disposeCallback: () => void) {}

    dispose(): void {
      this.disposeCallback();
    }
  }
};

const commandUtilsMock = {
  formatActionError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  getTreeItemLabel: () => "demo",
  requireSelection: <T>(item: T | undefined, missingSelectionMessage: string) => {
    if (!item) {
      informationMessages.push(missingSelectionMessage);
      return undefined;
    }
    return item;
  }
};

vi.doMock("vscode", () => vscodeMock);
vi.doMock("../src/commands/CommandUtils", () => commandUtilsMock);
const { JobConfigUpdateWorkflow } = await import("../src/commands/job/JobConfigUpdateWorkflow");

const environment = {
  environmentId: "env-1",
  scope: "workspace" as const,
  url: "https://jenkins.example/"
};

function createWorkflow(
  options: { getRemoteXml?: () => Promise<string>; updateConfigXml?: () => Promise<void> } = {}
) {
  const calls = {
    getJobConfigXml: 0,
    updateJobConfigXml: [] as string[],
    refreshes: [] as string[],
    discarded: [] as string[],
    closed: [] as string[]
  };

  const dataService = {
    getJobConfigXml: async () => {
      calls.getJobConfigXml += 1;
      return options.getRemoteXml ? options.getRemoteXml() : remoteXml;
    },
    updateJobConfigXml: async (_environment: unknown, _jobUrl: string, xml: string) => {
      calls.updateJobConfigXml.push(xml);
      await options.updateConfigXml?.();
    }
  };

  const draft = {
    environment,
    jobUrl: "job/demo/",
    label: "demo",
    originalUri: { toString: () => "job-config-original:/demo/config.xml" },
    originalXml: "<project><description>original</description></project>"
  };
  const draftManager = {
    getDraft: (uri: UriLike) => (uri.toString() === targetUri.toString() ? draft : undefined),
    getVisibleDrafts: () => [],
    discardDraft: (uri: UriLike) => {
      calls.discarded.push(uri.toString());
    }
  };

  const refreshHost = {
    fullEnvironmentRefresh: (request: { environmentId?: string }) => {
      if (request.environmentId) {
        calls.refreshes.push(request.environmentId);
      }
      return { executed: true };
    }
  };

  const editorService = {
    closeUris: async (uris: UriLike[]) => {
      calls.closed.push(...uris.map((uri) => uri.toString()));
      return true;
    }
  };

  return {
    workflow: new JobConfigUpdateWorkflow(
      dataService as never,
      {} as never,
      draftManager as never,
      editorService as never
    ),
    refreshHost,
    calls
  };
}

beforeEach(() => {
  documentText = "<project><description>edited</description></project>";
  remoteXml = "<project><description>original</description></project>";
  warningChoice = undefined;
  diagnostics = [{ severity: 1 }];
  quickPickCalls = 0;
  quickPickSelections = [];
  informationMessages.length = 0;
  vscodeMock.window.showWarningMessage.mockClear();
});

describe("JobConfigUpdateWorkflow startUpdate", () => {
  it("asks for a selection without loading config when no item is selected", async () => {
    const { workflow, calls } = createWorkflow();

    await workflow.startUpdate(undefined);

    assert.deepEqual(informationMessages, ["Select a job or pipeline to update its config."]);
    assert.equal(calls.getJobConfigXml, 0);
  });
});

describe("JobConfigUpdateWorkflow submitDraft", () => {
  it("submits when the remote config still matches the draft original", async () => {
    const { workflow, refreshHost, calls } = createWorkflow();

    await workflow.submitDraft(refreshHost, targetUri as never);

    assertSuccessfulSubmit(calls);
  });

  it("requests confirmation immediately when the document has no diagnostics", async () => {
    diagnostics = [];
    vi.useFakeTimers();
    const { workflow, refreshHost, calls } = createWorkflow();

    try {
      const submission = workflow.submitDraft(refreshHost, targetUri as never);
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(quickPickCalls, 1);
      assert.equal(vi.getTimerCount(), 0);
      await submission;
      assertSuccessfulSubmit(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks submission when the remote config changed after the draft opened", async () => {
    remoteXml = "<project><description>remote changed</description></project>";
    const { workflow, refreshHost, calls } = createWorkflow();

    await workflow.submitDraft(refreshHost, targetUri as never);

    assert.equal(calls.getJobConfigXml, 1);
    assert.deepEqual(calls.updateJobConfigXml, []);
    assert.deepEqual(calls.refreshes, []);
    assert.deepEqual(calls.discarded, []);
  });

  it("allows an explicit overwrite when the remote config changed", async () => {
    remoteXml = "<project><description>remote changed</description></project>";
    warningChoice = "Overwrite Remote";
    const { workflow, refreshHost, calls } = createWorkflow();

    await workflow.submitDraft(refreshHost, targetUri as never);

    assertSuccessfulSubmit(calls);
  });

  it("keeps a newer edit when confirmation of the changed draft is canceled", async () => {
    const remote = deferred<string>();
    quickPickSelections = [true, false];
    const { workflow, refreshHost, calls } = createWorkflow({ getRemoteXml: () => remote.promise });
    const submission = workflow.submitDraft(refreshHost, targetUri as never);
    await vi.waitFor(() => assert.equal(calls.getJobConfigXml, 1));

    documentText = "<project><description>newer edit</description></project>";
    remote.resolve(remoteXml);
    await submission;

    assert.equal(quickPickCalls, 2);
    assert.deepEqual(calls.updateJobConfigXml, []);
    assert.deepEqual(calls.closed, []);
    assert.deepEqual(calls.discarded, []);
  });

  it("submits the current text after confirming an edit made during the remote check", async () => {
    const remote = deferred<string>();
    const { workflow, refreshHost, calls } = createWorkflow({ getRemoteXml: () => remote.promise });
    const submission = workflow.submitDraft(refreshHost, targetUri as never);
    await vi.waitFor(() => assert.equal(calls.getJobConfigXml, 1));

    documentText = "<project><description>newer edit</description></project>";
    remote.resolve(remoteXml);
    await submission;

    assert.equal(quickPickCalls, 2);
    assertSuccessfulSubmit(calls);
  });

  it("allows only one submission for a draft at a time", async () => {
    const remote = deferred<string>();
    const { workflow, refreshHost, calls } = createWorkflow({ getRemoteXml: () => remote.promise });
    const first = workflow.submitDraft(refreshHost, targetUri as never);
    await vi.waitFor(() => assert.equal(calls.getJobConfigXml, 1));
    const second = workflow.submitDraft(refreshHost, targetUri as never);
    await second;
    remote.resolve(remoteXml);
    await first;

    assertSuccessfulSubmit(calls);
    assert.equal(quickPickCalls, 1);
  });

  it("keeps edits made while the upload is pending", async () => {
    const upload = deferred<void>();
    const { workflow, refreshHost, calls } = createWorkflow({
      updateConfigXml: () => upload.promise
    });
    const submission = workflow.submitDraft(refreshHost, targetUri as never);
    await vi.waitFor(() => assert.equal(calls.updateJobConfigXml.length, 1));

    documentText = "<project><description>newer edit</description></project>";
    upload.resolve();
    await submission;

    assert.deepEqual(calls.updateJobConfigXml, [
      "<project><description>edited</description></project>"
    ]);
    assert.deepEqual(calls.closed, []);
    assert.deepEqual(calls.discarded, []);
  });

  it.each([
    ["original", true],
    ["newer edit", true],
    ["edited", false]
  ] as const)(
    "compares retained draft contents '%s' against the last successful upload",
    async (description, shouldUpload) => {
      const upload = deferred<void>();
      const uploadedXml = documentText;
      const { workflow, refreshHost, calls } = createWorkflow({
        updateConfigXml: () => upload.promise
      });
      const submission = workflow.submitDraft(refreshHost, targetUri as never);
      await vi.waitFor(() => assert.equal(calls.updateJobConfigXml.length, 1));

      documentText = "<project><description>newer edit</description></project>";
      remoteXml = uploadedXml;
      upload.resolve();
      await submission;
      assert.deepEqual(calls.closed, []);
      assert.deepEqual(calls.discarded, []);

      documentText = `<project><description>${description}</description></project>`;
      await workflow.submitDraft(refreshHost, targetUri as never);

      assert.deepEqual(
        calls.updateJobConfigXml,
        shouldUpload ? [uploadedXml, documentText] : [uploadedXml]
      );
      assert.equal(calls.getJobConfigXml, shouldUpload ? 2 : 1);
      assert.equal(vscodeMock.window.showWarningMessage.mock.calls.length, 0);
    }
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function assertSuccessfulSubmit(calls: ReturnType<typeof createWorkflow>["calls"]): void {
  assert.equal(calls.getJobConfigXml, 1);
  assert.deepEqual(calls.updateJobConfigXml, [documentText]);
  assert.deepEqual(calls.refreshes, ["env-1"]);
  assert.deepEqual(calls.discarded, [targetUri.toString()]);
}
