import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsWatchStore } from "../src/storage/JenkinsWatchStore";

const informationMessages: string[] = [];

class TestJobTreeItem {
  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    public readonly label: string,
    public readonly jobUrl: string
  ) {}
}

vi.doMock("vscode", () => ({
  window: {
    showInformationMessage: async (message: string) => {
      informationMessages.push(message);
      return undefined;
    }
  }
}));
vi.doMock("../src/tree/TreeItems", () => ({
  BuildTreeItem: class {},
  JobTreeItem: TestJobTreeItem,
  NodeTreeItem: class {},
  PipelineTreeItem: class {}
}));

const { unwatchJob } = await import("../src/commands/watch/WatchCommandHandlers");

describe("unwatchJob", () => {
  it("waits for every alias removal and refreshes after a partial failure", async () => {
    informationMessages.length = 0;
    const environment: JenkinsEnvironmentRef = {
      environmentId: "env-1",
      scope: "workspace",
      url: "https://jenkins.example/"
    };
    const rawJobUrl = "https://legacy.example/job/demo/";
    const canonicalJobUrl = "https://jenkins.example/job/demo/";
    const events: string[] = [];
    let resolveRawRemoval: ((removed: boolean) => void) | undefined;
    const rawRemoval = new Promise<boolean>((resolve) => {
      resolveRawRemoval = resolve;
    });
    const watchStore = {
      removeWatch: async (_scope: string, _environmentId: string, jobUrl: string) => {
        events.push(`remove:${jobUrl}`);
        if (jobUrl === canonicalJobUrl) {
          throw new Error("canonical removal failed");
        }
        const removed = await rawRemoval;
        events.push("raw-settled");
        return removed;
      }
    } as unknown as JenkinsWatchStore;
    const refreshHost = {
      fullEnvironmentRefresh: () => {
        events.push("refresh");
        return { executed: true };
      }
    };
    const item = new TestJobTreeItem(environment, "demo", rawJobUrl);

    let settled = false;
    const result = unwatchJob(watchStore, refreshHost, item as never).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(settled, false);
    assert.deepEqual(events, [`remove:${rawJobUrl}`, `remove:${canonicalJobUrl}`]);

    resolveRawRemoval?.(true);
    await assert.rejects(result, {
      name: "AggregateError",
      message: "Failed to remove all watch aliases."
    });
    assert.deepEqual(events, [
      `remove:${rawJobUrl}`,
      `remove:${canonicalJobUrl}`,
      "raw-settled",
      "refresh"
    ]);
    assert.deepEqual(informationMessages, ["Stopped watching demo."]);
  });
});
