import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { EnvironmentWithScope } from "../src/storage/JenkinsEnvironmentStore";

type QuickPickItem = { label: string; description?: string };

let quickPickCalls: Array<{ items: QuickPickItem[]; options: unknown }> = [];
let quickPickIndex: number | undefined;
const infoMessages: string[] = [];

vi.doMock("vscode", () => ({
  window: {
    showInformationMessage: async (message: string) => {
      infoMessages.push(message);
      return undefined;
    },
    showQuickPick: async (items: QuickPickItem[], options: unknown) => {
      quickPickCalls.push({ items, options });
      return quickPickIndex === undefined ? undefined : items[quickPickIndex];
    }
  }
}));

const { pickJenkinsEnvironment } = await import("../src/commands/CommandUtils");

const copy = { emptyMessage: "Add one first.", placeHolder: "Pick one" };

function storeWith(environments: EnvironmentWithScope[]) {
  return { listEnvironmentsWithScope: async () => environments };
}

beforeEach(() => {
  quickPickCalls = [];
  quickPickIndex = undefined;
  infoMessages.length = 0;
});

describe("pickJenkinsEnvironment", () => {
  it("shows a message and does not prompt when there are no environments", async () => {
    const result = await pickJenkinsEnvironment(storeWith([]), copy);

    assert.equal(result, undefined);
    assert.deepEqual(infoMessages, ["Add one first."]);
    assert.equal(quickPickCalls.length, 0);
  });

  it("returns the only environment without prompting", async () => {
    const result = await pickJenkinsEnvironment(
      storeWith([{ id: "a", url: "https://a.test/", scope: "global" }]),
      copy
    );

    assert.equal(result?.environmentId, "a");
    assert.equal(result?.scope, "global");
    assert.equal(quickPickCalls.length, 0);
  });

  it("prompts with labels and scope/username descriptions when there are several", async () => {
    quickPickIndex = 1;
    const result = await pickJenkinsEnvironment(
      storeWith([
        { id: "a", url: "https://a.test/", name: "Alpha", username: "alice", scope: "workspace" },
        { id: "b", url: "https://b.test/", name: "Beta", scope: "global" }
      ]),
      copy
    );

    assert.equal(result?.environmentId, "b");
    assert.equal(quickPickCalls.length, 1);
    const [call] = quickPickCalls;
    assert.deepEqual(
      call.items.map(({ label, description }) => ({ label, description })),
      [
        { label: "Alpha", description: "workspace · alice" },
        { label: "Beta", description: "global" }
      ]
    );
    assert.deepEqual(call.options, { placeHolder: "Pick one", matchOnDescription: true });
  });

  it("returns undefined when the prompt is dismissed", async () => {
    const result = await pickJenkinsEnvironment(
      storeWith([
        { id: "a", url: "https://a.test/", scope: "workspace" },
        { id: "b", url: "https://b.test/", scope: "global" }
      ]),
      copy
    );

    assert.equal(result, undefined);
  });
});
