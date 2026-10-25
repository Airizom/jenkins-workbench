import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JenkinsDataService, JobSearchOptions } from "../src/jenkins/JenkinsDataService";
import type { JobHistoryPanelLauncher } from "../src/panels/JobHistoryPanelLauncher";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import * as vscodeStub from "./helpers/vscodeStub";

type Pick = { label: string; description?: string; url?: string; entry?: unknown };

const registeredCommands = new Map<string, (item?: unknown) => Promise<void>>();
const quickPickCalls: Pick[][] = [];
const errorMessages: string[] = [];
let progressOptions: { cancellable?: boolean } | undefined;
let cancelProgress = false;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  ProgressLocation: { Notification: 15 },
  commands: {
    registerCommand: (command: string, callback: (item?: unknown) => Promise<void>) => {
      registeredCommands.set(command, callback);
      return { dispose: () => undefined };
    }
  },
  window: {
    showQuickPick: async (items: Pick[]) => {
      quickPickCalls.push(items);
      return items[0];
    },
    withProgress: async (
      options: { cancellable?: boolean },
      task: (progress: unknown, token: { isCancellationRequested: boolean }) => Promise<unknown>
    ) => {
      progressOptions = options;
      const token = { isCancellationRequested: false };
      const result = task({ report: () => undefined }, token);
      if (cancelProgress) token.isCancellationRequested = true;
      return result;
    },
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    }
  }
}));

const { registerHistoryCommands } = await import("../src/commands/HistoryCommands");
const { CancellationError } = await import("../src/jenkins/errors");

const environmentEntry = {
  id: "env-1",
  scope: "workspace",
  url: "https://jenkins.example.com/",
  username: "user"
};

function setup(
  getAllJobs: (options?: JobSearchOptions) => Promise<unknown[]>,
  environmentEntries: unknown[] = [environmentEntry]
) {
  const shown: string[] = [];
  const data = {
    getAllJobsForEnvironment: vi.fn(async (_environment: unknown, options?: JobSearchOptions) =>
      getAllJobs(options)
    )
  } as unknown as JenkinsDataService;
  const environments = {
    listEnvironmentsWithScope: async () => environmentEntries
  } as unknown as JenkinsEnvironmentStore;
  const launcher = {
    show: async (_environment: unknown, url: string) => {
      shown.push(url);
    }
  } as unknown as JobHistoryPanelLauncher;
  registerHistoryCommands(
    { subscriptions: [] } as unknown as Parameters<typeof registerHistoryCommands>[0],
    data,
    environments,
    launcher
  );
  const command = registeredCommands.get("jenkinsWorkbench.openJobHistory");
  if (!command) throw new Error("openJobHistory was not registered");
  return { command, data, shown };
}

describe("registerHistoryCommands openJobHistory palette flow", () => {
  beforeEach(() => {
    registeredCommands.clear();
    quickPickCalls.length = 0;
    errorMessages.length = 0;
    progressOptions = undefined;
    cancelProgress = false;
  });

  it("loads jobs behind cancellable progress with a bounded, cancellable lookup", async () => {
    let received: JobSearchOptions | undefined;
    const { command, shown } = setup(async (options) => {
      received = options;
      return [{ fullName: "folder/app", url: "https://jenkins.example.com/job/folder/job/app/" }];
    });

    await command();

    expect(progressOptions?.cancellable).toBe(true);
    expect(received?.cancellation).toBeDefined();
    expect(received?.maxResults).toBe(2000);
    // The single configured environment is chosen without a prompt; only the job picker opens.
    expect(quickPickCalls).toHaveLength(1);
    expect(shown).toEqual(["https://jenkins.example.com/job/folder/job/app/"]);
  });

  it("stops quietly when the user cancels the job lookup", async () => {
    cancelProgress = true;
    const { command, shown } = setup(async (options) => {
      await Promise.resolve();
      const token = options?.cancellation as { isCancellationRequested: boolean };
      if (token.isCancellationRequested) throw new CancellationError();
      return [];
    });

    await command();

    expect(quickPickCalls).toHaveLength(0);
    expect(shown).toEqual([]);
    expect(errorMessages).toEqual([]);
  });

  it("still reports lookup failures that are not cancellations", async () => {
    const { command } = setup(async () => {
      throw new Error("boom");
    });

    await command();

    expect(errorMessages).toEqual(["Unable to open Job History: boom"]);
  });

  it("distinguishes environments that share a URL in the environment picker", async () => {
    const { command } = setup(
      async () => [],
      [environmentEntry, { id: "env-2", scope: "global", url: environmentEntry.url }]
    );

    await command();

    const environmentItems = quickPickCalls[0] ?? [];
    expect(environmentItems.map((item) => item.label)).toEqual([
      "jenkins.example.com",
      "jenkins.example.com"
    ]);
    expect(environmentItems.map((item) => item.description)).toEqual([
      "workspace · user",
      "global"
    ]);
  });
});
