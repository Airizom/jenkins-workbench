import type * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkCommandDependencies } from "../src/commands/BulkCommand";
import type { BuildTreeItem, WorkbenchTreeElement } from "../src/tree/TreeItems";
import * as vscodeStub from "./helpers/vscodeStub";

type CommandHandler = (
  item?: WorkbenchTreeElement,
  selection?: readonly WorkbenchTreeElement[]
) => Promise<void>;

const commands = new Map<string, CommandHandler>();
vi.doMock("vscode", () => ({
  ...vscodeStub,
  commands: {
    registerCommand: (id: string, handler: CommandHandler) => {
      commands.set(id, handler);
      return { dispose: () => commands.delete(id) };
    }
  }
}));

const { registerBuildCommands } = await import("../src/commands/BuildCommands");
const { registerQueueCommands } = await import("../src/commands/QueueCommands");
const { registerWatchCommands } = await import("../src/commands/WatchCommands");
const { registerPinCommands } = await import("../src/commands/PinCommands");

const primary = { id: "primary" } as WorkbenchTreeElement;
const other = { id: "other" } as WorkbenchTreeElement;
const currentSelection = [primary, other];

function setup() {
  const run = vi.fn(async () => undefined);
  const handleArtifactAction = vi.fn(async () => undefined);
  const resolve = vi.fn(
    (item?: WorkbenchTreeElement, selection?: readonly WorkbenchTreeElement[]) =>
      item ? (selection?.includes(item) ? [...selection] : [item]) : [...currentSelection]
  );
  const bulk: BulkCommandDependencies = {
    bulkActionService: { run },
    treeBulkSelection: { resolve }
  };
  const context = { subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
  registerBuildCommands(
    context,
    {} as never,
    {} as never,
    { handle: handleArtifactAction },
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      workflow: {} as never,
      descriptionDraftManager: {
        onDidRequestSubmit: () => ({ dispose: () => undefined })
      } as never
    },
    bulk
  );
  registerQueueCommands(context, bulk);
  registerWatchCommands(context, bulk);
  registerPinCommands(context, {} as never, {} as never, {} as never, bulk);
  return { run, resolve, context, handleArtifactAction };
}

async function invoke(id: string, item?: WorkbenchTreeElement, selection?: WorkbenchTreeElement[]) {
  const handler = commands.get(`jenkinsWorkbench.${id}`);
  expect(handler).toBeDefined();
  await handler?.(item, selection);
}

const actions = [
  ["abortBuild", "stop"],
  ["cancelQueueItem", "cancel"],
  ["watchJob", "watch"],
  ["unwatchJob", "unwatch"],
  ["pinJob", "pin"],
  ["unpinJob", "unpin"]
] as const;

beforeEach(() => commands.clear());

describe("bulk command registration", () => {
  it.each([false, true])(
    "registers archive download for a build with isBuilding=%s",
    async (isBuilding) => {
      const { handleArtifactAction, resolve } = setup();
      const build = {
        environment: {
          environmentId: "test",
          scope: "workspace",
          url: "https://jenkins.example/"
        },
        buildUrl: "https://jenkins.example/job/demo/42/",
        buildNumber: 42,
        jobNameHint: "demo",
        isBuilding
      } as BuildTreeItem;

      await invoke("downloadAllArtifacts", build);

      expect(handleArtifactAction).toHaveBeenCalledWith({
        action: "downloadAll",
        environment: build.environment,
        buildUrl: build.buildUrl,
        buildNumber: 42,
        jobNameHint: "demo"
      });
      expect(resolve).not.toHaveBeenCalled();
    }
  );

  it.each(actions)("routes %s context selections to %s", async (command, action) => {
    const { run, resolve } = setup();
    await invoke(command, primary, currentSelection);
    expect(resolve).toHaveBeenCalledWith(primary, currentSelection);
    expect(run).toHaveBeenCalledWith(action, currentSelection);
  });

  it.each(actions)(
    "uses the current tree selection for palette command %s",
    async (command, action) => {
      const { run, resolve } = setup();
      await invoke(command);
      expect(resolve).toHaveBeenCalledWith(undefined, undefined);
      expect(run).toHaveBeenCalledWith(action, currentSelection);
    }
  );

  it.each(actions)("preserves explicit single-item calls to %s", async (command, action) => {
    const { run } = setup();
    await invoke(command, primary);
    expect(run).toHaveBeenCalledWith(action, [primary]);
  });

  it.each([
    ["abortBuild.single", "stop"],
    ["cancelQueueItem.single", "cancel"],
    ["pinJob.single", "pin"],
    ["unpinJob.single", "unpin"]
  ])("keeps %s row-only despite a second selection argument", async (command, action) => {
    const { run, resolve } = setup();
    await invoke(command, primary, currentSelection);
    expect(resolve).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(action, [primary]);
  });

  it("does not fall back to the tree selection for a missing inline row", async () => {
    const { run, resolve } = setup();
    await invoke("abortBuild.single");
    expect(resolve).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith("stop", []);
  });

  it("disposes every registered bulk command with its extension context", () => {
    const { context } = setup();
    for (const subscription of context.subscriptions) subscription.dispose();
    for (const [command] of actions)
      expect(commands.has(`jenkinsWorkbench.${command}`)).toBe(false);
    expect(commands.has("jenkinsWorkbench.abortBuild.single")).toBe(false);
    expect(commands.has("jenkinsWorkbench.cancelQueueItem.single")).toBe(false);
    expect(commands.has("jenkinsWorkbench.pinJob.single")).toBe(false);
    expect(commands.has("jenkinsWorkbench.unpinJob.single")).toBe(false);
    expect(commands.has("jenkinsWorkbench.downloadAllArtifacts")).toBe(false);
  });
});
