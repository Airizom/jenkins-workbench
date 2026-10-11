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
    this.activeItems = value.slice(0, 1);
  }

  activeItems: unknown[] = [];

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

  it("keeps the highlighted job when a later batch arrives", async () => {
    const quickPick = new TestQuickPick();
    let goToJobCommand: (() => Promise<void>) | undefined;
    let releaseSecondBatch: (() => void) | undefined;
    const secondBatchGate = new Promise<void>((resolve) => {
      releaseSecondBatch = resolve;
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
          }
        ]
      } as JenkinsEnvironmentStore,
      {
        async *iterateJobsForEnvironment() {
          yield [
            { name: "Mike", fullName: "Mike", url: "https://jenkins.example/job/mike/" },
            { name: "Zulu", fullName: "Zulu", url: "https://jenkins.example/job/zulu/" }
          ];
          await secondBatchGate;
          yield [{ name: "Alpha", fullName: "Alpha", url: "https://jenkins.example/job/alpha/" }];
        }
      } as unknown as JenkinsDataService,
      {} as JenkinsViewStateStore,
      {} as JenkinsTreeNavigator
    );

    if (!goToJobCommand || !releaseSecondBatch) {
      throw new Error("Go to Job test setup failed.");
    }
    await goToJobCommand();
    await vi.waitFor(() => expect(quickPick.items).toHaveLength(2));

    quickPick.activeItems = [quickPick.items[1]];
    expect(quickPick.activeItems).toMatchObject([{ label: "Zulu" }]);

    releaseSecondBatch();
    await vi.waitFor(() => expect(quickPick.busy).toBe(false));

    expect(quickPick.items).toMatchObject([
      { label: "Alpha" },
      { label: "Mike" },
      { label: "Zulu" }
    ]);
    expect(quickPick.activeItems).toMatchObject([
      { entry: { url: "https://jenkins.example/job/zulu/" } }
    ]);
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

type RegisteredCommands = Map<string, (...args: unknown[]) => Promise<void>>;

async function loadSearchCommands(options: {
  quickPick?: TestQuickPick;
  showInformationMessage?: (...args: unknown[]) => Promise<unknown>;
  showWarningMessage?: (...args: unknown[]) => Promise<unknown>;
  showInputBox?: (...args: unknown[]) => Promise<string | undefined>;
  iterateJobsForEnvironment?: (...args: unknown[]) => AsyncGenerator<unknown[]>;
  environments?: Array<{ id: string; scope: string; url: string }>;
  viewStateStore?: Partial<JenkinsViewStateStore>;
}): Promise<RegisteredCommands> {
  const commands: RegisteredCommands = new Map();
  vi.resetModules();
  vi.doMock("vscode", () => ({
    ...vscodeStub,
    CancellationError: class CancellationError extends Error {},
    CancellationTokenSource: TestCancellationTokenSource,
    commands: {
      registerCommand: (command: string, callback: (...args: unknown[]) => Promise<void>) => {
        commands.set(command, callback);
        return { dispose: () => undefined };
      }
    },
    window: {
      createQuickPick: () => options.quickPick ?? new TestQuickPick(),
      showInformationMessage: options.showInformationMessage ?? (async () => undefined),
      showWarningMessage: options.showWarningMessage ?? (async () => undefined),
      showInputBox: options.showInputBox ?? (async () => undefined)
    },
    workspace: {
      getConfiguration: () => ({
        get: () => undefined
      })
    }
  }));
  const { registerSearchCommands } = await import("../src/commands/SearchCommands");

  registerSearchCommands(
    { subscriptions: [] } as never,
    {
      listEnvironmentsWithScope: async () =>
        options.environments ?? [
          { id: "env-1", scope: "workspace", url: "https://jenkins.example/" }
        ]
    } as JenkinsEnvironmentStore,
    {
      iterateJobsForEnvironment:
        options.iterateJobsForEnvironment ??
        async function* () {
          yield* [];
        }
    } as unknown as JenkinsDataService,
    (options.viewStateStore ?? {}) as JenkinsViewStateStore,
    {} as JenkinsTreeNavigator
  );
  return commands;
}

function getCommand(
  commands: RegisteredCommands,
  id: string
): (...args: unknown[]) => Promise<void> {
  const command = commands.get(id);
  if (!command) {
    throw new Error(`${id} was not registered.`);
  }
  return command;
}

describe("goToJob edge cases", () => {
  it("cancels the load token on hide and suppresses the cancellation error", async () => {
    const quickPick = new TestQuickPick();
    const showWarningMessage = vi.fn(async () => undefined);
    const showInformationMessage = vi.fn(async () => undefined);
    let failLoad: ((error: Error) => void) | undefined;
    const loadGate = new Promise<void>((_resolve, reject) => {
      failLoad = reject;
    });
    let observedToken: { isCancellationRequested: boolean } | undefined;

    const commands = await loadSearchCommands({
      quickPick,
      showWarningMessage,
      showInformationMessage,
      iterateJobsForEnvironment: async function* (...args: unknown[]) {
        const opts = args[1] as { cancellation: { isCancellationRequested: boolean } };
        observedToken = opts.cancellation;
        await loadGate;
        yield [];
      }
    });

    await getCommand(commands, "jenkinsWorkbench.goToJob")();
    await vi.waitFor(() => expect(observedToken).toBeDefined());

    quickPick.hide();
    expect(observedToken?.isCancellationRequested).toBe(true);

    const { CancellationError } = await import("../src/jenkins/JenkinsDataService");
    failLoad?.(new CancellationError());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(quickPick.disposed).toBe(true);
  });

  it("clears busy and reports no jobs once every environment finishes empty", async () => {
    const quickPick = new TestQuickPick();
    const showInformationMessage = vi.fn(async () => undefined);

    const commands = await loadSearchCommands({
      quickPick,
      showInformationMessage,
      environments: [
        { id: "env-1", scope: "workspace", url: "https://one.example/" },
        { id: "env-2", scope: "workspace", url: "https://two.example/" }
      ]
    });

    await getCommand(commands, "jenkinsWorkbench.goToJob")();
    await vi.waitFor(() => expect(quickPick.busy).toBe(false));

    expect(showInformationMessage).toHaveBeenCalledTimes(1);
    expect(showInformationMessage).toHaveBeenCalledWith(
      "No jobs found with current search settings."
    );
    expect(quickPick.items).toEqual([]);
  });

  it("de-duplicates repeated job URLs within an environment", async () => {
    const quickPick = new TestQuickPick();
    const job = { name: "Alpha", fullName: "Alpha", url: "https://jenkins.example/job/alpha/" };

    const commands = await loadSearchCommands({
      quickPick,
      iterateJobsForEnvironment: async function* () {
        yield [job, job];
        yield [job];
      }
    });

    await getCommand(commands, "jenkinsWorkbench.goToJob")();
    await vi.waitFor(() => expect(quickPick.busy).toBe(false));

    expect(quickPick.items).toHaveLength(1);
    expect(quickPick.itemAssignmentCount).toBe(1);
  });
});

describe("branch filter commands", () => {
  const multibranchItem = {
    label: "Repo",
    folderKind: "multibranch",
    folderUrl: "https://jenkins.example/job/repo/",
    environment: { environmentId: "env-1" }
  };

  it("rejects non-multibranch folders without prompting", async () => {
    const showInformationMessage = vi.fn(async () => undefined);
    const showInputBox = vi.fn(async () => "main");
    const setBranchFilter = vi.fn(async () => undefined);
    const commands = await loadSearchCommands({
      showInformationMessage,
      showInputBox,
      viewStateStore: { setBranchFilter }
    });

    await getCommand(
      commands,
      "jenkinsWorkbench.filterBranches"
    )({
      ...multibranchItem,
      folderKind: "folder"
    });

    expect(showInformationMessage).toHaveBeenCalledWith("Select a multibranch folder to filter.");
    expect(showInputBox).not.toHaveBeenCalled();
    expect(setBranchFilter).not.toHaveBeenCalled();
  });

  it("passes blank input through so the filter is cleared", async () => {
    const setBranchFilter = vi.fn(async () => undefined);
    const showInputBox = vi.fn(async () => "");
    const commands = await loadSearchCommands({
      showInputBox,
      viewStateStore: { getBranchFilter: () => "feature", setBranchFilter }
    });

    await getCommand(commands, "jenkinsWorkbench.filterBranches")(multibranchItem);

    expect(showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ value: "feature", prompt: expect.stringContaining("Repo") })
    );
    expect(setBranchFilter).toHaveBeenCalledWith("env-1", "https://jenkins.example/job/repo/", "");
  });

  it("leaves the filter unchanged when the input box is dismissed", async () => {
    const setBranchFilter = vi.fn(async () => undefined);
    const commands = await loadSearchCommands({
      showInputBox: async () => undefined,
      viewStateStore: { getBranchFilter: () => undefined, setBranchFilter }
    });

    await getCommand(commands, "jenkinsWorkbench.filterBranches")(multibranchItem);

    expect(setBranchFilter).not.toHaveBeenCalled();
  });
});
