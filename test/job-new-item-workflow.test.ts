import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

let warningChoice: string | undefined;
const informationMessages: string[] = [];
const errorMessages: string[] = [];

const vscodeMock = {
  window: {
    showQuickPick: async (items: readonly unknown[]) => items[1],
    showInputBox: async () => "demo",
    showWarningMessage: vi.fn(async () => warningChoice),
    showInformationMessage: async (message: string) => {
      informationMessages.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    }
  }
};

vi.doMock("vscode", () => vscodeMock);
const { JobNewItemWorkflow } = await import("../src/commands/job/JobNewItemWorkflow");

const target = {
  environment: {
    environmentId: "env-1",
    scope: "workspace" as const,
    url: "https://jenkins.example/"
  },
  parentUrl: "https://jenkins.example/",
  locationLabel: "https://jenkins.example/ (Workspace)"
};

function createWorkflow(createItem: () => Promise<{ newUrl?: string }>) {
  const changedEnvironments: string[] = [];
  const workflow = new JobNewItemWorkflow({
    dataService: { createItem } as never,
    onEnvironmentChanged: (environmentId) => {
      changedEnvironments.push(environmentId);
    }
  });
  return { workflow, changedEnvironments };
}

beforeEach(() => {
  warningChoice = "Create";
  informationMessages.length = 0;
  errorMessages.length = 0;
  vscodeMock.window.showWarningMessage.mockClear();
});

describe("JobNewItemWorkflow", () => {
  it("does not create the item when the modal confirmation is dismissed", async () => {
    warningChoice = undefined;
    const createItem = vi.fn(async () => ({}));
    const { workflow } = createWorkflow(createItem);

    await workflow.run(target);

    assert.deepEqual(vscodeMock.window.showWarningMessage.mock.calls[0], [
      'Create pipeline "demo" in https://jenkins.example/ (Workspace)?',
      { modal: true },
      "Create"
    ]);
    assert.equal(createItem.mock.calls.length, 0);
  });

  it("reports successful creation and refreshes the environment", async () => {
    const { workflow, changedEnvironments } = createWorkflow(async () => ({
      newUrl: "https://jenkins.example/job/demo/"
    }));

    await workflow.run(target);

    assert.deepEqual(informationMessages, [
      'Created pipeline "demo". New job URL: https://jenkins.example/job/demo/'
    ]);
    assert.deepEqual(changedEnvironments, ["env-1"]);
    assert.deepEqual(errorMessages, []);
  });

  it("shows the create failure message when Jenkins rejects the item", async () => {
    const { workflow, changedEnvironments } = createWorkflow(async () => {
      throw new Error("already exists");
    });

    await workflow.run(target);

    assert.deepEqual(errorMessages, ['Failed to create pipeline "demo": already exists']);
    assert.deepEqual(changedEnvironments, []);
  });
});
