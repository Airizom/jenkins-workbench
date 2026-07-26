import { describe, expect, it, vi } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import type { JenkinsViewStateStore } from "../src/storage/JenkinsViewStateStore";
import type { JenkinsTreeNavigator } from "../src/tree/TreeNavigator";
import * as vscodeStub from "./helpers/vscodeStub";

class TestCancellationTokenSource {
  readonly token = { isCancellationRequested: false };
  cancelCalled = false;
  disposeCalled = false;

  cancel(): void {
    this.cancelCalled = true;
    this.token.isCancellationRequested = true;
  }

  dispose(): void {
    this.disposeCalled = true;
  }
}

class TestQuickPick {
  selectedItems: unknown[] = [];
  items: unknown[] = [];
  placeholder = "";
  matchOnDescription = false;
  matchOnDetail = false;
  busy = false;
  disposed = false;
  private hideListener: (() => void) | undefined;

  onDidAccept(): { dispose(): void } {
    return { dispose: () => undefined };
  }

  onDidHide(listener: () => void): { dispose(): void } {
    this.hideListener = listener;
    return { dispose: () => undefined };
  }

  show(): void {}

  hide(): void {
    this.hideListener?.();
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe("registerSearchCommands", () => {
  it("disposes the Go to Job cancellation source when the quick pick hides", async () => {
    const tokenSources: TestCancellationTokenSource[] = [];
    const quickPick = new TestQuickPick();
    let goToJobCommand: (() => Promise<void>) | undefined;

    const vscodeMock = {
      ...vscodeStub,
      CancellationError: class CancellationError extends Error {},
      CancellationTokenSource: class extends TestCancellationTokenSource {
        constructor() {
          super();
          tokenSources.push(this);
        }
      },
      ThemeColor: class {
        constructor(readonly id: string) {}
      },
      ThemeIcon: class {
        constructor(
          readonly id: string,
          readonly color?: unknown
        ) {}
      },
      commands: {
        registerCommand: (command: string, callback: () => Promise<void>) => {
          if (command === "jenkinsWorkbench.goToJob") {
            goToJobCommand = callback;
          }
          return { dispose: () => undefined };
        }
      },
      window: {
        createQuickPick: () => quickPick,
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined
      },
      workspace: {
        getConfiguration: () => ({
          get: () => undefined
        })
      }
    };

    vi.doMock("vscode", () => vscodeMock);
    const { registerSearchCommands } = await import("../src/commands/SearchCommands");

    registerSearchCommands(
      { subscriptions: [] } as never,
      {
        listEnvironmentsWithScope: async () => [
          {
            id: "env-1",
            scope: "workspace",
            url: "https://jenkins.example/"
          }
        ]
      } as JenkinsEnvironmentStore,
      {
        async *iterateJobsForEnvironment() {
          yield* [];
        }
      } as unknown as JenkinsDataService,
      {} as JenkinsViewStateStore,
      {} as JenkinsTreeNavigator
    );

    if (!goToJobCommand) {
      throw new Error("Go to Job command was not registered.");
    }
    await goToJobCommand();
    quickPick.hide();

    expect(tokenSources).toHaveLength(1);
    expect(tokenSources[0].cancelCalled).toBe(true);
    expect(tokenSources[0].disposeCalled).toBe(true);
    expect(quickPick.disposed).toBe(true);
  });
});
