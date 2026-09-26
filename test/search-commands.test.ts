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
  private currentItems: unknown[] = [];
  itemAssignmentCount = 0;
  placeholder = "";
  matchOnDescription = false;
  matchOnDetail = false;
  busy = false;
  disposed = false;
  private hideListener: (() => void) | undefined;

  get items(): unknown[] {
    return this.currentItems;
  }

  set items(value: unknown[]) {
    this.currentItems = value;
    this.itemAssignmentCount += 1;
  }

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

    vi.resetModules();
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

  it("publishes sorted job results while another environment is still loading", async () => {
    const quickPick = new TestQuickPick();
    let goToJobCommand: (() => Promise<void>) | undefined;
    let releaseSlowEnvironment: (() => void) | undefined;
    const slowEnvironmentGate = new Promise<void>((resolve) => {
      releaseSlowEnvironment = resolve;
    });

    const vscodeMock = {
      ...vscodeStub,
      CancellationError: class CancellationError extends Error {},
      CancellationTokenSource: TestCancellationTokenSource,
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

    vi.resetModules();
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
          },
          {
            id: "env-2",
            scope: "workspace",
            url: "https://slow.example/"
          }
        ]
      } as JenkinsEnvironmentStore,
      {
        async *iterateJobsForEnvironment(environment: { url: string }) {
          if (environment.url === "https://slow.example/") {
            await slowEnvironmentGate;
            yield [
              {
                name: "Alpha",
                fullName: "Alpha",
                url: "https://slow.example/job/alpha/"
              }
            ];
          } else {
            yield [
              {
                name: "Zulu",
                fullName: "Zulu",
                url: "https://jenkins.example/job/zulu/"
              }
            ];
          }
        }
      } as unknown as JenkinsDataService,
      {} as JenkinsViewStateStore,
      {} as JenkinsTreeNavigator
    );

    if (!goToJobCommand || !releaseSlowEnvironment) {
      throw new Error("Go to Job test setup failed.");
    }
    await goToJobCommand();
    await vi.waitFor(() => expect(quickPick.items).toMatchObject([{ label: "Zulu" }]));

    expect(quickPick.busy).toBe(true);
    expect(quickPick.itemAssignmentCount).toBe(1);

    releaseSlowEnvironment();
    await vi.waitFor(() => expect(quickPick.busy).toBe(false));

    expect(quickPick.itemAssignmentCount).toBe(2);
    expect(quickPick.items).toMatchObject([{ label: "Alpha" }, { label: "Zulu" }]);
  });

  it("shows only the detailed warning when an environment fails to load", async () => {
    const quickPick = new TestQuickPick();
    const showWarningMessage = vi.fn(async () => undefined);
    let goToJobCommand: (() => Promise<void>) | undefined;

    const vscodeMock = {
      ...vscodeStub,
      CancellationError: class CancellationError extends Error {},
      CancellationTokenSource: TestCancellationTokenSource,
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
        showWarningMessage
      },
      workspace: {
        getConfiguration: () => ({
          get: () => undefined
        })
      }
    };

    vi.resetModules();
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
          await Promise.reject(new Error("connection failed"));
          yield [];
        }
      } as unknown as JenkinsDataService,
      {} as JenkinsViewStateStore,
      {} as JenkinsTreeNavigator
    );

    if (!goToJobCommand) {
      throw new Error("Go to Job command was not registered.");
    }
    await goToJobCommand();
    await vi.waitFor(() => expect(quickPick.busy).toBe(false));

    expect(showWarningMessage).toHaveBeenCalledTimes(1);
    expect(showWarningMessage).toHaveBeenCalledWith(
      "Unable to load jobs for https://jenkins.example/: connection failed"
    );
  });
});
