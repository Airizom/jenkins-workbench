import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

type UriLike = { toString(): string };

const calls: string[] = [];
const informationMessages: string[] = [];
const errorMessages: string[] = [];
let warningChoice: string | undefined;
let inputBoxValue: string | undefined;
let quickPickIndex: number | undefined;
let documentText = "";
let activeUri: UriLike | undefined;

const showWarningMessage = vi.fn(
  async (_message: string, _options?: unknown, ..._items: string[]) => warningChoice
);
const showInputBox = vi.fn(async (_options?: unknown) => inputBoxValue);
const showQuickPick = vi.fn(async (items: unknown[]) =>
  quickPickIndex === undefined ? undefined : items[quickPickIndex]
);
const showTextDocument = vi.fn(async () => undefined);
const openTextDocument = vi.fn(async (uri: UriLike) => ({ uri, getText: () => documentText }));

vi.doMock("vscode", () => ({
  ...vscodeStub,
  ProgressLocation: { Notification: 15 },
  window: {
    get activeTextEditor() {
      return activeUri ? { document: { uri: activeUri } } : undefined;
    },
    showInformationMessage: async (message: string) => {
      informationMessages.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showWarningMessage,
    showInputBox,
    showQuickPick,
    showTextDocument,
    withProgress: async (_options: unknown, task: () => Promise<unknown>) => task()
  },
  workspace: { openTextDocument }
}));

const { BuildManagementWorkflow } = await import("../src/services/build/BuildManagementWorkflow");
const { toBuildManagementTarget } = await import("../src/commands/build/BuildManagementHandlers");

const environment = {
  environmentId: "env-1",
  scope: "workspace" as const,
  url: "https://jenkins.example/"
};
const buildUrl = "https://jenkins.example/job/demo/12/";
const target = { environment, buildUrl, label: "demo #12", isBuilding: false };

type State = {
  number: number;
  building: boolean;
  keepLog: boolean;
  displayName?: string;
  description?: string;
};
let state: State;
let deleteError: Error | undefined;

const dataService = {
  getBuildManagementState: vi.fn(async () => {
    calls.push("getState");
    return { ...state };
  }),
  setBuildKeepForever: vi.fn(async (_env: unknown, _url: string, keep: boolean) => {
    calls.push(`keep:${keep}`);
    return keep;
  }),
  deleteBuild: vi.fn(async (_env: unknown, _url: string, options?: { releaseKeep?: boolean }) => {
    calls.push(options?.releaseKeep ? "delete:releaseKeep" : "delete");
    if (deleteError) {
      throw deleteError;
    }
  }),
  setBuildDescription: vi.fn(async (_env: unknown, _url: string, description: string) => {
    calls.push(`description:${description}`);
  }),
  setBuildDisplayName: vi.fn(async (_env: unknown, _url: string, displayName: string) => {
    calls.push(`displayName:${displayName}`);
  })
};

const refreshHost = {
  fullEnvironmentRefresh: vi.fn((request: { environmentId: string }) => {
    calls.push(`refresh:${request.environmentId}`);
    return { executed: true };
  })
};

const closeBuildDetailsFor = vi.fn((_env: unknown, url: string) => {
  calls.push(`close:${url}`);
});

type Draft = {
  environment: typeof environment;
  buildUrl: string;
  label: string;
  originalDescription: string;
};
const drafts = new Map<string, Draft>();
const visibleDraftUris: UriLike[] = [];
const draftManager = {
  createDraft: vi.fn((label: string, _content: string, draft: Draft) => {
    const uri = { toString: () => `jenkins-build-description:/${label}` };
    drafts.set(uri.toString(), draft);
    return uri;
  }),
  getDraft: (uri: UriLike) => drafts.get(uri.toString()),
  getVisibleDrafts: () =>
    visibleDraftUris.map((uri) => ({ uri, label: drafts.get(uri.toString())?.label ?? "?" })),
  discardDraft: vi.fn((uri: UriLike) => {
    drafts.delete(uri.toString());
  })
};

const editorService = {
  closeUris: vi.fn(async () => true)
};

function createWorkflow() {
  return new BuildManagementWorkflow({
    dataService: dataService as never,
    refreshHost,
    draftManager: draftManager as never,
    closeBuildDetailsFor,
    editorService: editorService as never
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  informationMessages.length = 0;
  errorMessages.length = 0;
  drafts.clear();
  visibleDraftUris.length = 0;
  warningChoice = undefined;
  inputBoxValue = undefined;
  quickPickIndex = undefined;
  documentText = "";
  activeUri = undefined;
  deleteError = undefined;
  state = { number: 12, building: false, keepLog: false, displayName: "#12", description: "" };
});

describe("deleteBuild", () => {
  it("refuses running builds without contacting Jenkins", async () => {
    const result = await createWorkflow().deleteBuild({ ...target, isBuilding: true });

    assert.equal(result, "unchanged");
    assert.deepEqual(calls, []);
    assert.deepEqual(informationMessages, [
      "Build demo #12 is still running. Stop it before deleting."
    ]);
  });

  it("refuses builds that Jenkins reports as running", async () => {
    state.building = true;

    const result = await createWorkflow().deleteBuild(target);

    assert.equal(result, "unchanged");
    assert.deepEqual(calls, ["getState"]);
    assert.equal(showWarningMessage.mock.calls.length, 0);
  });

  it("does nothing when the confirmation is dismissed", async () => {
    const result = await createWorkflow().deleteBuild(target);

    assert.equal(result, "cancelled");
    assert.deepEqual(calls, ["getState"]);
    assert.deepEqual(showWarningMessage.mock.calls[0], [
      "Delete build demo #12? This cannot be undone.",
      { modal: true, detail: undefined },
      "Delete"
    ]);
  });

  it("deletes, closes Build Details, and refreshes", async () => {
    warningChoice = "Delete";

    const result = await createWorkflow().deleteBuild(target);

    assert.equal(result, "deleted");
    assert.deepEqual(calls, ["getState", "delete", `close:${buildUrl}`, "refresh:env-1"]);
    assert.deepEqual(informationMessages, ["Deleted build demo #12."]);
  });

  it("asks the data layer to release keep-forever when deleting a kept build", async () => {
    state.keepLog = true;
    warningChoice = "Stop Keeping and Delete";

    const result = await createWorkflow().deleteBuild(target);

    assert.equal(result, "deleted");
    const [, options, button] = showWarningMessage.mock.calls[0];
    assert.deepEqual(options, { modal: true, detail: "This build is marked to be kept forever." });
    assert.equal(button, "Stop Keeping and Delete");
    assert.deepEqual(calls, [
      "getState",
      "delete:releaseKeep",
      `close:${buildUrl}`,
      "refresh:env-1"
    ]);
  });

  it("reports failure and refreshes when deleting a kept build fails", async () => {
    state.keepLog = true;
    warningChoice = "Stop Keeping and Delete";
    deleteError = new Error("Jenkins did not delete the build.");

    const result = await createWorkflow().deleteBuild(target);

    assert.equal(result, "failed");
    assert.deepEqual(calls, ["getState", "delete:releaseKeep", "refresh:env-1"]);
    assert.equal(closeBuildDetailsFor.mock.calls.length, 0);
    assert.deepEqual(errorMessages, [
      "Failed to delete build demo #12: Jenkins did not delete the build."
    ]);
  });

  it("reports failure without refreshing when deleting an unkept build fails", async () => {
    warningChoice = "Delete";
    deleteError = new Error("Forbidden");

    const result = await createWorkflow().deleteBuild(target);

    assert.equal(result, "failed");
    assert.deepEqual(calls, ["getState", "delete"]);
    assert.deepEqual(errorMessages, ["Failed to delete build demo #12: Forbidden"]);
  });
});

describe("keep forever", () => {
  it("sets the requested state and refreshes", async () => {
    const result = await createWorkflow().setKeepForever(target, true);

    assert.equal(result, "changed");
    assert.deepEqual(calls, ["keep:true", "refresh:env-1"]);
    assert.deepEqual(informationMessages, ["Build demo #12 will be kept forever."]);
  });

  it("reports failure without refreshing", async () => {
    dataService.setBuildKeepForever.mockRejectedValueOnce(new Error("refused"));

    const result = await createWorkflow().setKeepForever(target, true);

    assert.equal(result, "failed");
    assert.equal(refreshHost.fullEnvironmentRefresh.mock.calls.length, 0);
  });
});

describe("editDisplayName", () => {
  it("treats the default #N name as empty and sends nothing when unchanged", async () => {
    inputBoxValue = "  ";

    const result = await createWorkflow().editDisplayName(target);

    assert.equal(result, "unchanged");
    assert.deepEqual(calls, ["getState"]);
    const options = showInputBox.mock.calls[0][0] as { value: string; prompt: string };
    assert.equal(options.value, "");
    assert.equal(options.prompt, "Display name for demo #12. Leave empty to reset to #12.");
  });

  it("returns cancelled when the input box is dismissed", async () => {
    state.displayName = "Release";

    const result = await createWorkflow().editDisplayName(target);

    assert.equal(result, "cancelled");
    assert.deepEqual(calls, ["getState"]);
  });

  it("sends an empty name to reset a custom display name", async () => {
    state.displayName = "Release";
    inputBoxValue = "";

    const result = await createWorkflow().editDisplayName(target);

    assert.equal(result, "changed");
    assert.deepEqual(calls, ["getState", "displayName:", "refresh:env-1"]);
  });

  it("sends the trimmed new name", async () => {
    inputBoxValue = "  Release 1.0 ";

    const result = await createWorkflow().editDisplayName(target);

    assert.equal(result, "changed");
    assert.deepEqual(calls, ["getState", "displayName:Release 1.0", "refresh:env-1"]);
  });
});

describe("editDescription", () => {
  it("sends nothing when the description is unchanged", async () => {
    state.description = "Nightly";
    inputBoxValue = "Nightly";

    const result = await createWorkflow().editDescription(target);

    assert.equal(result, "unchanged");
    assert.deepEqual(calls, ["getState"]);
  });

  it("clears the description when the input is empty", async () => {
    state.description = "Nightly";
    inputBoxValue = "";

    const result = await createWorkflow().editDescription(target);

    assert.equal(result, "changed");
    assert.deepEqual(calls, ["getState", "description:", "refresh:env-1"]);
    assert.deepEqual(informationMessages, ["Cleared the description of build demo #12."]);
  });

  it("opens a draft editor for multi-line descriptions instead of an input box", async () => {
    state.description = "line one\nline two";

    const result = await createWorkflow().editDescription(target);

    assert.equal(result, "unchanged");
    assert.equal(showInputBox.mock.calls.length, 0);
    assert.equal(draftManager.createDraft.mock.calls.length, 1);
    assert.deepEqual(draftManager.createDraft.mock.calls[0], [
      "demo #12",
      "line one\nline two",
      { environment, buildUrl, label: "demo #12", originalDescription: "line one\nline two" }
    ]);
    assert.equal(openTextDocument.mock.calls.length, 1);
    assert.equal(showTextDocument.mock.calls.length, 1);
    assert.match(informationMessages[0] ?? "", /Jenkins: Submit Build Description/);
  });

  it("delegates from the edit quick pick", async () => {
    quickPickIndex = 1;
    inputBoxValue = "New";

    const result = await createWorkflow().editBuild(target);

    assert.equal(result, "changed");
    assert.deepEqual(calls, ["getState", "description:New", "refresh:env-1"]);
  });

  it("opens the draft editor for a single-line description when forced", async () => {
    state.description = "Nightly";

    const result = await createWorkflow().editDescription(target, { inEditor: true });

    assert.equal(result, "unchanged");
    assert.equal(showInputBox.mock.calls.length, 0);
    assert.deepEqual(draftManager.createDraft.mock.calls[0], [
      "demo #12",
      "Nightly",
      { environment, buildUrl, label: "demo #12", originalDescription: "Nightly" }
    ]);
    assert.equal(showTextDocument.mock.calls.length, 1);
  });

  it("offers editing the description in the editor from the edit quick pick", async () => {
    state.description = "Nightly";
    quickPickIndex = 2;

    const result = await createWorkflow().editBuild(target);

    const items = showQuickPick.mock.calls[0]?.[0] as Array<{ label: string }>;
    assert.deepEqual(
      items.map((item) => item.label),
      ["Edit Display Name", "Edit Description", "Edit Description in Editor"]
    );
    assert.equal(result, "unchanged");
    assert.equal(showInputBox.mock.calls.length, 0);
    assert.equal(draftManager.createDraft.mock.calls.length, 1);
  });

  it("returns cancelled when the edit quick pick is dismissed", async () => {
    const result = await createWorkflow().editBuild(target);

    assert.equal(result, "cancelled");
    assert.deepEqual(calls, []);
  });
});

describe("submitDescriptionDraft", () => {
  const draftUri = { toString: () => "jenkins-build-description:/demo" };

  function openDraft(originalDescription: string): void {
    drafts.set(draftUri.toString(), {
      environment,
      buildUrl,
      label: "demo #12",
      originalDescription
    });
  }

  it("reports no changes without contacting Jenkins", async () => {
    openDraft("a\nb");
    documentText = "a\nb";

    const result = await createWorkflow().submitDescriptionDraft(draftUri as never);

    assert.equal(result, "unchanged");
    assert.deepEqual(calls, []);
  });

  it("submits, refreshes, closes the editor, and discards the draft", async () => {
    openDraft("a\nb");
    state.description = "a\nb";
    documentText = "a\nb\nc";

    const result = await createWorkflow().submitDescriptionDraft(draftUri as never);

    assert.equal(result, "changed");
    assert.deepEqual(calls, ["getState", "description:a\nb\nc", "refresh:env-1"]);
    assert.equal(showWarningMessage.mock.calls.length, 0);
    assert.deepEqual(editorService.closeUris.mock.calls[0], [[draftUri]]);
    assert.equal(drafts.has(draftUri.toString()), false);
  });

  it("asks before overwriting a remote change and respects cancel", async () => {
    openDraft("a\nb");
    state.description = "changed remotely";
    documentText = "a\nb\nc";

    const result = await createWorkflow().submitDescriptionDraft(draftUri as never);

    assert.equal(result, "cancelled");
    assert.deepEqual(calls, ["getState"]);
    assert.deepEqual(showWarningMessage.mock.calls[0], [
      "The description for demo #12 changed in Jenkins after this draft was opened. Overwrite it?",
      { modal: true },
      "Overwrite Remote"
    ]);
    assert.equal(drafts.has(draftUri.toString()), true);
  });

  it("overwrites the remote description when confirmed", async () => {
    openDraft("a\nb");
    state.description = "changed remotely";
    documentText = "a\nb\nc";
    warningChoice = "Overwrite Remote";

    const result = await createWorkflow().submitDescriptionDraft(draftUri as never);

    assert.equal(result, "changed");
    assert.deepEqual(calls, ["getState", "description:a\nb\nc", "refresh:env-1"]);
  });

  it("falls back to the single visible draft when the active editor is not a draft", async () => {
    openDraft("a\nb");
    visibleDraftUris.push(draftUri);
    activeUri = { toString: () => "file:///other.txt" };
    state.description = "a\nb";
    documentText = "updated";

    const result = await createWorkflow().submitDescriptionDraft();

    assert.equal(result, "changed");
    assert.deepEqual(calls, ["getState", "description:updated", "refresh:env-1"]);
  });

  it("ignores a second submit while the first is in flight", async () => {
    openDraft("a\nb");
    state.description = "a\nb";
    documentText = "new";
    const workflow = createWorkflow();

    const [first, second] = await Promise.all([
      workflow.submitDescriptionDraft(draftUri as never),
      workflow.submitDescriptionDraft(draftUri as never)
    ]);

    assert.equal(first, "changed");
    assert.equal(second, "unchanged");
    assert.equal(dataService.setBuildDescription.mock.calls.length, 1);
  });
});

describe("toBuildManagementTarget", () => {
  function buildItem(overrides: Record<string, unknown> = {}) {
    return {
      label: "#12",
      environment,
      buildUrl: "https://jenkins.example/job/folder/job/my%20job/12/",
      isBuilding: true,
      ...overrides
    } as never;
  }

  it("labels the build with the job name parsed from its URL", () => {
    assert.deepEqual(toBuildManagementTarget(buildItem()), {
      environment,
      buildUrl: "https://jenkins.example/job/folder/job/my%20job/12/",
      label: "my job #12",
      isBuilding: true
    });
  });

  it("prefers the job name hint", () => {
    assert.equal(toBuildManagementTarget(buildItem({ jobNameHint: "hinted" })).label, "hinted #12");
  });
});
