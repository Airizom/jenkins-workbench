import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

function createPanel() {
  const disposeListeners: Array<() => void> = [];
  return {
    title: "",
    reveal: vi.fn(),
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: () => undefined };
    },
    dispose: () => {
      for (const listener of disposeListeners) listener();
    },
    webview: { options: {}, html: "", cspSource: "csp" }
  };
}

const createWebviewPanel = vi.fn(() => createPanel());

vi.doMock("vscode", () => ({
  window: { createWebviewPanel },
  ViewColumn: { Active: -1 }
}));
vi.doMock("../src/panels/jobHistory/HistoryController", () => ({
  HistoryController: class {
    dispose(): void {}
    restore(): void {}
    setContext(): void {}
  }
}));
vi.doMock("../src/panels/shared/webview/WebviewAssets", () => ({
  getWebviewAssetsRoot: () => ({}),
  resolveWebviewAssets: () => {
    throw new Error("assets unavailable in unit tests");
  }
}));
vi.doMock("../src/panels/shared/webview/WebviewHtml", () => ({
  assignWebviewPanelManifestErrorHtml: () => undefined,
  createMissingPanelAssetsMessages: () => ({}),
  createTypedPanelRenderer: () => ({ renderPanelHtml: () => "" })
}));

const { JobHistoryPanelLauncher } = await import("../src/panels/JobHistoryPanelLauncher");

const environment = {
  scope: "global",
  environmentId: "env-1",
  url: "https://jenkins.example.com/"
} as never;

function createLauncher() {
  return new JobHistoryPanelLauncher({} as never, {} as never, {} as never);
}

describe("JobHistoryPanelLauncher", () => {
  it("reveals the existing panel when the job URL differs only by trailing slash", async () => {
    createWebviewPanel.mockClear();
    const launcher = createLauncher();

    await launcher.show(environment, "https://jenkins.example.com/job/app/");
    await launcher.show(environment, "https://jenkins.example.com/job/app");

    assert.equal(createWebviewPanel.mock.calls.length, 1);
    const panel = createWebviewPanel.mock.results[0]?.value as ReturnType<typeof createPanel>;
    assert.equal(panel.reveal.mock.calls.length, 1);
  });

  it("opens a new panel after the previous one is disposed", async () => {
    createWebviewPanel.mockClear();
    const launcher = createLauncher();

    await launcher.show(environment, "https://jenkins.example.com/job/app");
    const panel = createWebviewPanel.mock.results[0]?.value as ReturnType<typeof createPanel>;
    panel.dispose();
    await launcher.show(environment, "https://jenkins.example.com/job/app/");

    assert.equal(createWebviewPanel.mock.calls.length, 2);
  });
});
