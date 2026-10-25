import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentStoreChange } from "../src/storage/JenkinsEnvironmentStore";
import { EventEmitter } from "./helpers/vscodeStub";

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

function createLauncher(emitter = new EventEmitter<JenkinsEnvironmentStoreChange>()) {
  return new JobHistoryPanelLauncher(
    {} as never,
    {} as never,
    {
      onDidChange: emitter.event
    } as never
  );
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

  it("closes the environment's panels after its URL changes", async () => {
    createWebviewPanel.mockClear();
    const emitter = new EventEmitter<JenkinsEnvironmentStoreChange>();
    const launcher = createLauncher(emitter);
    const otherEnvironment = {
      scope: "workspace",
      environmentId: "env-1",
      url: "https://jenkins.example.com/"
    } as never;

    await launcher.show(environment, "https://jenkins.example.com/job/app/");
    await launcher.show(environment, "https://jenkins.example.com/job/lib/");
    await launcher.show(otherEnvironment, "https://jenkins.example.com/job/app/");
    const [app, lib, other] = createWebviewPanel.mock.results.map((result) =>
      vi.spyOn(result.value as ReturnType<typeof createPanel>, "dispose")
    );

    emitter.fire({
      kind: "environment-updated",
      scope: "global",
      environmentId: "env-1",
      urlChanged: false,
      environment: { id: "env-1", url: "https://edited.example/" }
    });
    emitter.fire({ kind: "environment-removed", scope: "global", environmentId: "env-1" });
    assert.equal(app.mock.calls.length + lib.mock.calls.length, 0);

    emitter.fire({
      kind: "environment-updated",
      scope: "global",
      environmentId: "env-1",
      urlChanged: true,
      environment: { id: "env-1", url: "https://edited.example/" }
    });

    assert.equal(app.mock.calls.length, 1);
    assert.equal(lib.mock.calls.length, 1);
    assert.equal(other.mock.calls.length, 0);

    await launcher.show(environment, "https://jenkins.example.com/job/app/");
    assert.equal(createWebviewPanel.mock.calls.length, 4);
  });

  it.each([true, false])(
    "closes only matching panels when TLS changes to %s",
    async (allowInsecureTls) => {
      createWebviewPanel.mockClear();
      const emitter = new EventEmitter<JenkinsEnvironmentStoreChange>();
      const launcher = createLauncher(emitter);
      await launcher.show(environment, "https://jenkins.example.com/job/app/");
      await launcher.show(
        { ...(environment as object), scope: "workspace" } as never,
        "https://jenkins.example.com/job/app/"
      );
      const [matching, otherScope] = createWebviewPanel.mock.results.map((result) =>
        vi.spyOn(result.value as ReturnType<typeof createPanel>, "dispose")
      );

      emitter.fire({
        kind: "environment-updated",
        scope: "global",
        environmentId: "env-1",
        urlChanged: false,
        tlsPolicyChanged: true,
        environment: { id: "env-1", url: "https://jenkins.example.com/", allowInsecureTls }
      });

      assert.equal(matching.mock.calls.length, 1);
      assert.equal(otherScope.mock.calls.length, 0);
      launcher.dispose();
    }
  );

  it("stops listening for environment changes when disposed", async () => {
    createWebviewPanel.mockClear();
    const emitter = new EventEmitter<JenkinsEnvironmentStoreChange>();
    const launcher = createLauncher(emitter);
    await launcher.show(environment, "https://jenkins.example.com/job/app/");
    const panel = createWebviewPanel.mock.results[0]?.value as ReturnType<typeof createPanel>;
    const dispose = vi.spyOn(panel, "dispose");

    launcher.dispose();
    emitter.fire({
      kind: "environment-updated",
      scope: "global",
      environmentId: "env-1",
      urlChanged: true,
      environment: { id: "env-1", url: "https://edited.example/" }
    });

    assert.equal(dispose.mock.calls.length, 0);
  });
});
