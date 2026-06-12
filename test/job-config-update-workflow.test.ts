import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { exactModuleMock, suffixModuleMock, withModuleMocks } from "./helpers/moduleMock";

type UriLike = { toString(): string };

const targetUri: UriLike = {
  toString: () => "job-config-draft:/demo/config.xml"
};

let documentText = "<project><description>edited</description></project>";
let remoteXml = "<project><description>original</description></project>";
let warningChoice: string | undefined;
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
    showQuickPick: async (items: unknown[]) => items[0],
    showWarningMessage: async () => warningChoice,
    withProgress: async (_options: unknown, task: () => Promise<unknown>) => task()
  },
  workspace: {
    openTextDocument: async () => ({
      getText: () => documentText
    }),
    onDidCloseTextDocument: () => ({ dispose: () => undefined })
  },
  languages: {
    getDiagnostics: () => [{ severity: 1 }],
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
  getTreeItemLabel: () => "demo"
};

const { JobConfigUpdateWorkflow } = withModuleMocks(
  [exactModuleMock("vscode", vscodeMock), suffixModuleMock("CommandUtils", commandUtilsMock)],
  () => require("../src/commands/job/JobConfigUpdateWorkflow")
) as typeof import("../src/commands/job/JobConfigUpdateWorkflow");

const environment = {
  environmentId: "env-1",
  scope: "workspace" as const,
  url: "https://jenkins.example/"
};

function createWorkflow() {
  const calls = {
    getJobConfigXml: 0,
    updateJobConfigXml: [] as string[],
    refreshes: [] as string[],
    discarded: [] as string[]
  };

  const dataService = {
    getJobConfigXml: async () => {
      calls.getJobConfigXml += 1;
      return remoteXml;
    },
    updateJobConfigXml: async (_environment: unknown, _jobUrl: string, xml: string) => {
      calls.updateJobConfigXml.push(xml);
    }
  };

  const draftManager = {
    getDraft: (uri: UriLike) =>
      uri.toString() === targetUri.toString()
        ? {
            environment,
            jobUrl: "job/demo/",
            label: "demo",
            originalUri: { toString: () => "job-config-original:/demo/config.xml" },
            originalXml: "<project><description>original</description></project>"
          }
        : undefined,
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
    closeUris: async () => true
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
  informationMessages.length = 0;
});

describe("JobConfigUpdateWorkflow submitDraft", () => {
  it("submits when the remote config still matches the draft original", async () => {
    const { workflow, refreshHost, calls } = createWorkflow();

    await workflow.submitDraft(refreshHost, targetUri as never);

    assert.equal(calls.getJobConfigXml, 1);
    assert.deepEqual(calls.updateJobConfigXml, [documentText]);
    assert.deepEqual(calls.refreshes, ["env-1"]);
    assert.deepEqual(calls.discarded, [targetUri.toString()]);
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

    assert.equal(calls.getJobConfigXml, 1);
    assert.deepEqual(calls.updateJobConfigXml, [documentText]);
    assert.deepEqual(calls.refreshes, ["env-1"]);
    assert.deepEqual(calls.discarded, [targetUri.toString()]);
  });
});
