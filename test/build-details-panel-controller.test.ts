import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { BuildDetailsPanelController } from "../src/panels/buildDetails/BuildDetailsPanelController";

describe("BuildDetailsPanelController", () => {
  it("retries build details through a full load", async () => {
    const backend = {};
    const environment = { id: "environment" };
    const options = { label: "Build", panelState: { selectedTab: "console" } };
    const load = vi.fn().mockResolvedValue({ status: "ok" });
    const controller = {
      backend,
      state: {
        environment,
        currentBuildUrl: "https://jenkins.example/job/example/1/"
      },
      load
    } as unknown as BuildDetailsPanelController;

    await BuildDetailsPanelController.prototype.refreshBuildDetails.call(controller, options);

    assert.deepEqual(load.mock.calls, [
      [backend, environment, "https://jenkins.example/job/example/1/", options]
    ]);
  });

  it("refreshes the exact raw console byte window used for HTML diagnostic offsets", async () => {
    const changed = vi.fn();
    const getConsoleTextProgressive = vi.fn(async () => ({ text: "new HTML-backed text" }));
    const prototype = BuildDetailsPanelController.prototype;
    const controller = Object.assign(Object.create(prototype), {
      backend: { console: { getConsoleTextProgressive } },
      state: {
        environment: { environmentId: "environment", scope: "workspace" },
        currentBuildUrl: "https://jenkins.example/job/example/1/"
      },
      loadTokenTracker: { current: 3, isCurrent: (token: number) => token === 3 },
      diagnosticConsoleText: "old text",
      diagnosticConsoleSyncGeneration: 0,
      diagnosticConsoleSyncQueue: Promise.resolve(),
      diagnosticConsoleTextSynchronized: true,
      onDiagnosticConsoleTextChanged: changed
    }) as BuildDetailsPanelController;
    const syncDiagnosticConsoleText = Reflect.get(prototype, "syncDiagnosticConsoleText") as (
      this: BuildDetailsPanelController,
      textRange: { start: number; end: number }
    ) => Promise<void>;

    await syncDiagnosticConsoleText.call(controller, { start: 7, end: 29 });

    assert.equal(controller.getDiagnosticConsoleText(), "new HTML-backed text");
    assert.deepEqual(getConsoleTextProgressive.mock.calls, [
      [
        { environmentId: "environment", scope: "workspace" },
        "https://jenkins.example/job/example/1/",
        7,
        22
      ]
    ]);
    assert.equal(changed.mock.calls.length, 1);
  });

  it("fetches and appends only the new raw text bytes for HTML append updates", async () => {
    const changed = vi.fn();
    const getConsoleTextProgressive = vi.fn(async () => ({ text: "tail" }));
    const prototype = BuildDetailsPanelController.prototype;
    const controller = Object.assign(Object.create(prototype), {
      backend: { console: { getConsoleTextProgressive } },
      state: {
        environment: { environmentId: "environment", scope: "workspace" },
        currentBuildUrl: "https://jenkins.example/job/example/1/"
      },
      loadTokenTracker: { current: 3, isCurrent: (token: number) => token === 3 },
      diagnosticConsoleText: "seed",
      diagnosticConsoleSyncGeneration: 0,
      diagnosticConsoleSyncQueue: Promise.resolve(),
      diagnosticConsoleTextSynchronized: true,
      onDiagnosticConsoleTextChanged: changed
    }) as BuildDetailsPanelController;
    const syncDiagnosticConsoleText = Reflect.get(prototype, "syncDiagnosticConsoleText") as (
      this: BuildDetailsPanelController,
      textRange: { start: number; end: number },
      appendedTextRange?: { start: number; end: number }
    ) => Promise<void>;

    await syncDiagnosticConsoleText.call(controller, { start: 0, end: 8 }, { start: 4, end: 8 });

    assert.equal(controller.getDiagnosticConsoleText(), "seedtail");
    assert.deepEqual(getConsoleTextProgressive.mock.calls, [
      [
        { environmentId: "environment", scope: "workspace" },
        "https://jenkins.example/job/example/1/",
        4,
        4
      ]
    ]);
    assert.equal(changed.mock.calls.length, 1);
  });

  it("clears diagnostic console offsets when current HTML text synchronization fails", async () => {
    const changed = vi.fn();
    const prototype = BuildDetailsPanelController.prototype;
    const controller = Object.assign(Object.create(prototype), {
      backend: {
        console: {
          getConsoleTextProgressive: async () => {
            throw new Error("console text unavailable");
          }
        }
      },
      state: {
        environment: { environmentId: "environment", scope: "workspace" },
        currentBuildUrl: "https://jenkins.example/job/example/1/"
      },
      loadTokenTracker: { current: 3, isCurrent: (token: number) => token === 3 },
      diagnosticConsoleText: "stale HTML-backed text",
      diagnosticConsoleSyncGeneration: 0,
      diagnosticConsoleSyncQueue: Promise.resolve(),
      diagnosticConsoleTextSynchronized: true,
      onDiagnosticConsoleTextChanged: changed
    }) as BuildDetailsPanelController;
    const syncDiagnosticConsoleText = Reflect.get(prototype, "syncDiagnosticConsoleText") as (
      this: BuildDetailsPanelController,
      textRange: { start: number; end: number }
    ) => Promise<void>;

    await syncDiagnosticConsoleText.call(controller, { start: 20, end: 40 });

    assert.equal(controller.getDiagnosticConsoleText(), "");
    assert.equal(changed.mock.calls.length, 1);
  });
});
