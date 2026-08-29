import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { BuildDetailsDiagnosticConsoleSync } from "../src/panels/buildDetails/BuildDetailsDiagnosticConsoleSync";
import { BuildDetailsPanelController } from "../src/panels/buildDetails/BuildDetailsPanelController";

const environment = {
  environmentId: "environment",
  scope: "workspace",
  url: "https://jenkins.example/"
} as const;
const buildUrl = "https://jenkins.example/job/example/1/";

function createDiagnosticConsoleSync(
  getConsoleTextProgressive: (...args: unknown[]) => Promise<{ text: string }>,
  changed: () => void,
  initialText = ""
): BuildDetailsDiagnosticConsoleSync {
  const sync = new BuildDetailsDiagnosticConsoleSync({
    maxConsoleChars: 100_000,
    getBackend: () => ({ getConsoleTextProgressive }) as never,
    getEnvironment: () => environment,
    getBuildUrl: () => buildUrl,
    getLoadToken: () => 3,
    isLoadTokenCurrent: (token) => token === 3,
    onTextChanged: changed
  });
  sync.setText(initialText);
  return sync;
}

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
    const sync = createDiagnosticConsoleSync(getConsoleTextProgressive, changed, "old text");

    await sync.sync({ start: 7, end: 29 });

    assert.equal(sync.getText(), "new HTML-backed text");
    assert.deepEqual(getConsoleTextProgressive.mock.calls, [[environment, buildUrl, 7, 22]]);
    assert.equal(changed.mock.calls.length, 1);
  });

  it("fetches and appends only the new raw text bytes for HTML append updates", async () => {
    const changed = vi.fn();
    const getConsoleTextProgressive = vi.fn(async () => ({ text: "tail" }));
    const sync = createDiagnosticConsoleSync(getConsoleTextProgressive, changed, "seed");

    await sync.sync({ start: 0, end: 8 }, { start: 4, end: 8 });

    assert.equal(sync.getText(), "seedtail");
    assert.deepEqual(getConsoleTextProgressive.mock.calls, [[environment, buildUrl, 4, 4]]);
    assert.equal(changed.mock.calls.length, 1);
  });

  it("clears diagnostic console offsets when current HTML text synchronization fails", async () => {
    const changed = vi.fn();
    const getConsoleTextProgressive = async (): Promise<{ text: string }> => {
      throw new Error("console text unavailable");
    };
    const sync = createDiagnosticConsoleSync(
      getConsoleTextProgressive,
      changed,
      "stale HTML-backed text"
    );

    await sync.sync({ start: 20, end: 40 });

    assert.equal(sync.getText(), "");
    assert.equal(changed.mock.calls.length, 1);
  });
});
