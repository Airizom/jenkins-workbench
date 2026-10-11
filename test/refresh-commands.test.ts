import { describe, expect, it, vi } from "vitest";
import type { ExtensionRefreshHost } from "../src/extension/ExtensionRefreshHost";
import type { JenkinsWorkbenchTreeDataProvider } from "../src/tree/TreeDataProvider";
import type { TreeExpansionState } from "../src/tree/TreeExpansionState";
import * as vscodeStub from "./helpers/vscodeStub";

type RefreshCommand = (item?: { environmentId: string }) => Promise<void>;

async function setup(executed: boolean) {
  let refreshCommand: RefreshCommand | undefined;
  let resolveWaiter: (() => void) | undefined;
  const events: string[] = [];
  const waiter = {
    token: Symbol("refresh-token"),
    promise: new Promise<void>((resolve) => {
      resolveWaiter = () => {
        events.push("waiter-resolved");
        resolve();
      };
    }),
    dispose: vi.fn()
  };
  const snapshot = { expanded: ["a"] };
  const expansionState = {
    snapshot: vi.fn(() => snapshot),
    restore: vi.fn(async () => {
      events.push("restore");
    })
  };
  const fullEnvironmentRefresh = vi.fn(() => ({ executed }));

  vi.resetModules();
  vi.doMock("vscode", () => ({
    ...vscodeStub,
    commands: {
      registerCommand: (command: string, callback: RefreshCommand) => {
        if (command === "jenkinsWorkbench.refresh") {
          refreshCommand = callback;
        }
        return { dispose: () => undefined };
      }
    }
  }));
  const { registerRefreshCommands } = await import("../src/commands/RefreshCommands");

  registerRefreshCommands(
    { subscriptions: [] } as never,
    { createRefreshWaiter: () => waiter } as unknown as JenkinsWorkbenchTreeDataProvider,
    expansionState as unknown as TreeExpansionState,
    { fullEnvironmentRefresh } as unknown as ExtensionRefreshHost
  );
  if (!refreshCommand || !resolveWaiter) {
    throw new Error("Refresh command was not registered.");
  }
  return {
    refreshCommand,
    resolveWaiter,
    waiter,
    snapshot,
    expansionState,
    fullEnvironmentRefresh,
    events
  };
}

describe("registerRefreshCommands", () => {
  it("disposes the waiter and skips restore when the refresh does not run", async () => {
    const { refreshCommand, waiter, expansionState, fullEnvironmentRefresh } = await setup(false);

    await refreshCommand();

    expect(fullEnvironmentRefresh).toHaveBeenCalledWith({
      trigger: "manual",
      refreshToken: waiter.token
    });
    expect(waiter.dispose).toHaveBeenCalledTimes(1);
    expect(expansionState.restore).not.toHaveBeenCalled();
  });

  it("waits for the refresh waiter before restoring the expansion snapshot", async () => {
    const {
      refreshCommand,
      resolveWaiter,
      waiter,
      snapshot,
      expansionState,
      fullEnvironmentRefresh,
      events
    } = await setup(true);

    const pending = refreshCommand({ environmentId: "env-1" });
    await Promise.resolve();
    expect(expansionState.restore).not.toHaveBeenCalled();

    resolveWaiter();
    await pending;

    expect(fullEnvironmentRefresh).toHaveBeenCalledWith({
      environmentId: "env-1",
      trigger: "manual",
      refreshToken: waiter.token
    });
    expect(waiter.dispose).not.toHaveBeenCalled();
    expect(expansionState.restore).toHaveBeenCalledWith(snapshot);
    expect(events).toEqual(["waiter-resolved", "restore"]);
  });
});
