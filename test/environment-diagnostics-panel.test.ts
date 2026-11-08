import * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentDiagnosticsReport } from "../src/environmentDiagnostics/EnvironmentDiagnosticsContracts";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsEnvironment,
  JenkinsEnvironmentStore,
  JenkinsEnvironmentStoreChange
} from "../src/storage/JenkinsEnvironmentStore";
import * as shim from "./helpers/vscodeStub";

const created: ReturnType<typeof createPanel>[] = [];
const clipboard = vi.fn();
const openExternal = vi.fn(async () => true);
const configChanges = new shim.EventEmitter<{
  affectsConfiguration: (section: string) => boolean;
}>();
let requestTimeoutSeconds = 30;
vi.doMock("vscode", () => ({
  ...shim,
  ViewColumn: { One: 1 },
  window: {
    createWebviewPanel: () => {
      const panel = createPanel();
      created.push(panel);
      return panel;
    }
  },
  workspace: {
    onDidChangeConfiguration: configChanges.event,
    getConfiguration: () => ({ get: () => requestTimeoutSeconds })
  },
  commands: { executeCommand: vi.fn(async () => undefined) },
  env: { clipboard: { writeText: clipboard }, openExternal }
}));
vi.doMock("../src/panels/shared/webview/WebviewAssets", () => ({
  getWebviewAssetsRoot: () => shim.Uri.file("/extension/out/webview"),
  resolveWebviewAssets: () => ({ scriptUri: "webview:/diagnostics.js", styleUris: [] })
}));
const { EnvironmentDiagnosticsPanelLauncher } = await import(
  "../src/panels/EnvironmentDiagnosticsPanel"
);

type PanelModel =
  import("../src/panels/environmentDiagnostics/shared/EnvironmentDiagnosticsPanelMessages").EnvironmentDiagnosticsViewModel;

function createPanel() {
  const messages = new shim.EventEmitter<unknown>();
  const views = new shim.EventEmitter<void>();
  const disposals = new shim.EventEmitter<void>();
  const updates: PanelModel[] = [];
  return {
    title: "",
    visible: true,
    iconPath: undefined as unknown,
    webview: {
      html: "",
      options: {},
      cspSource: "webview:",
      onDidReceiveMessage: messages.event,
      postMessage: vi.fn(async (message: { model: PanelModel }) => {
        updates.push(structuredClone(message.model));
        return true;
      })
    },
    updates,
    messages,
    views,
    onDidChangeViewState: views.event,
    onDidDispose: disposals.event,
    reveal: vi.fn(function (this: { visible: boolean }) {
      this.visible = true;
      views.fire();
    }),
    dispose: () => disposals.fire()
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const ref: JenkinsEnvironmentRef = {
  environmentId: "env",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const stored: JenkinsEnvironment = { id: "env", url: ref.url };
function report(runId = 1): EnvironmentDiagnosticsReport {
  return {
    runId,
    startedAt: "2026-11-08T15:00:00Z",
    completedAt: "2026-11-08T15:00:01Z",
    checks: [
      {
        id: "authentication",
        label: "Authentication",
        status: "failed",
        code: "auth",
        summary: "Credentials rejected.",
        detail: "Update credentials.",
        actions: ["editCredentials"]
      }
    ]
  };
}

function setup(run = vi.fn(async (_ref: JenkinsEnvironmentRef, runId: number) => report(runId))) {
  const changes = new shim.EventEmitter<JenkinsEnvironmentStoreChange>();
  let environment: JenkinsEnvironment | undefined = { ...stored };
  const getEnvironments = vi.fn(async () => (environment ? [environment] : []));
  const recover = vi.fn(async () => false);
  const store = {
    getEnvironments,
    onDidChange: changes.event
  } as unknown as JenkinsEnvironmentStore;
  const launcher = new EnvironmentDiagnosticsPanelLauncher({
    extensionUri: vscode.Uri.file("/extension"),
    store,
    service: { run },
    recover
  });
  return {
    launcher,
    changes,
    run,
    recover,
    getEnvironments,
    setEnvironment: (next: JenkinsEnvironment | undefined) => {
      environment = next;
    }
  };
}

const launchers: InstanceType<typeof EnvironmentDiagnosticsPanelLauncher>[] = [];
beforeEach(() => {
  created.length = 0;
  clipboard.mockClear();
  openExternal.mockClear();
  requestTimeoutSeconds = 30;
});
afterEach(() => {
  for (const launcher of launchers.splice(0)) launcher.dispose();
});

function latest() {
  const updates = created[0].updates;
  return updates[updates.length - 1];
}

describe("Environment Diagnostics panel", () => {
  it("automatically retests a visible panel after a request timeout change", async () => {
    const ctx = setup();
    launchers.push(ctx.launcher);
    await ctx.launcher.show(ref);
    requestTimeoutSeconds = 45;
    configChanges.fire({
      affectsConfiguration: (section) => section === "jenkinsWorkbench.requestTimeoutSeconds"
    });
    await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(latest().state).toBe("completed"));
  });

  it("defers timeout retesting while hidden and ignores unchanged or unrelated settings", async () => {
    const ctx = setup();
    launchers.push(ctx.launcher);
    await ctx.launcher.show(ref);
    configChanges.fire({ affectsConfiguration: () => true });
    expect(ctx.run).toHaveBeenCalledOnce();
    requestTimeoutSeconds = 60;
    configChanges.fire({ affectsConfiguration: () => false });
    expect(ctx.run).toHaveBeenCalledOnce();
    created[0].visible = false;
    configChanges.fire({
      affectsConfiguration: (section) => section === "jenkinsWorkbench.requestTimeoutSeconds"
    });
    await vi.waitFor(() => expect(latest().report).toBeUndefined());
    expect(ctx.run).toHaveBeenCalledOnce();
    created[0].visible = true;
    created[0].views.fire();
    await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledTimes(2));
  });

  it("reveals the existing panel and prevents overlapping runs", async () => {
    const pending = deferred<EnvironmentDiagnosticsReport>();
    const run = vi.fn(
      async (_ref: JenkinsEnvironmentRef, _runId: number, _signal?: AbortSignal) => pending.promise
    );
    const ctx = setup(run);
    launchers.push(ctx.launcher);
    const first = ctx.launcher.show(ref);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await ctx.launcher.show(ref);
    expect(created).toHaveLength(1);
    expect(created[0].reveal).toHaveBeenCalledOnce();
    created[0].messages.fire({ type: "environmentDiagnosticsReady" });
    await vi.waitFor(() => expect(latest().state).toBe("running"));
    pending.resolve(report());
    await first;
    expect(latest().state).toBe("completed");
  });

  it("cancels immediately and ignores a late service result", async () => {
    const pending = deferred<EnvironmentDiagnosticsReport>();
    let signal: AbortSignal | undefined;
    const run = vi.fn(
      async (_ref: JenkinsEnvironmentRef, _id: number, nextSignal?: AbortSignal) => {
        signal = nextSignal;
        return pending.promise;
      }
    );
    const ctx = setup(run);
    launchers.push(ctx.launcher);
    const showing = ctx.launcher.show(ref);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    created[0].messages.fire({ type: "cancel" });
    await vi.waitFor(() => expect(latest().state).toBe("cancelled"));
    expect(signal?.aborted).toBe(true);
    pending.resolve(report());
    await showing;
    expect(latest().report).toBeUndefined();
  });

  it("keeps a panel open and retests once after a multi-event recovery", async () => {
    const ctx = setup();
    launchers.push(ctx.launcher);
    await ctx.launcher.show(ref);
    ctx.recover.mockImplementation(async () => {
      ctx.setEnvironment({ ...stored, url: "https://new.example/" });
      ctx.changes.fire({
        kind: "environment-updated",
        scope: "workspace",
        environmentId: "env",
        environment: { ...stored, url: "https://new.example/" },
        urlChanged: true
      });
      ctx.changes.fire({ kind: "auth-config-updated", scope: "workspace", environmentId: "env" });
      await Promise.resolve();
      return true;
    });
    created[0].messages.fire({ type: "recover", action: "editCredentials" });
    await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledTimes(2));
    expect(created).toHaveLength(1);
    expect(ctx.run.mock.calls[1][0].url).toBe("https://new.example/");
    await vi.waitFor(() => expect(latest().state).toBe("completed"));
  });

  it("does not rerun a cancelled recovery or accept an unoffered recovery action", async () => {
    const ctx = setup();
    launchers.push(ctx.launcher);
    await ctx.launcher.show(ref);
    created[0].messages.fire({ type: "recover", action: "tlsSettings" });
    created[0].messages.fire({ type: "recover", action: "editCredentials" });
    created[0].messages.fire({ type: "recover", action: "editCredentials" });
    await vi.waitFor(() => expect(ctx.recover).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(latest().recovering).toBe(false));
    expect(ctx.run).toHaveBeenCalledOnce();
    expect(latest().state).toBe("completed");
  });

  it("defers changed settings checks until a hidden panel is revealed", async () => {
    const ctx = setup();
    launchers.push(ctx.launcher);
    await ctx.launcher.show(ref);
    created[0].visible = false;
    ctx.changes.fire({ kind: "auth-config-updated", scope: "workspace", environmentId: "env" });
    await vi.waitFor(() => expect(latest().report).toBeUndefined());
    expect(ctx.run).toHaveBeenCalledOnce();
    created[0].visible = true;
    created[0].views.fire();
    await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledTimes(2));
  });

  it("renames without retesting, copies a safe report, and ignores other environments", async () => {
    const ctx = setup();
    launchers.push(ctx.launcher);
    await ctx.launcher.show(ref);
    ctx.setEnvironment({ ...stored, name: "Renamed" });
    ctx.changes.fire({
      kind: "environment-updated",
      scope: "workspace",
      environmentId: "env",
      environment: { ...stored, name: "Renamed" },
      urlChanged: false
    });
    await vi.waitFor(() => expect(created[0].title).toContain("Renamed"));
    ctx.changes.fire({ kind: "auth-config-updated", scope: "global", environmentId: "env" });
    ctx.changes.fire({ kind: "auth-config-updated", scope: "workspace", environmentId: "other" });
    created[0].messages.fire({ type: "copyReport" });
    await vi.waitFor(() => expect(clipboard).toHaveBeenCalledOnce());
    expect(clipboard.mock.calls[0][0]).toContain("Renamed");
    expect(clipboard.mock.calls[0][0]).toContain("Run state: completed");
    expect(ctx.run).toHaveBeenCalledOnce();
  });

  it("never resurrects removed environments when a saved-record lookup resolves late", async () => {
    const ctx = setup();
    launchers.push(ctx.launcher);
    await ctx.launcher.show(ref);
    const pending = deferred<JenkinsEnvironment[]>();
    ctx.getEnvironments.mockImplementationOnce(() => pending.promise);
    ctx.changes.fire({ kind: "auth-config-updated", scope: "workspace", environmentId: "env" });
    ctx.setEnvironment(undefined);
    ctx.changes.fire({ kind: "environment-removed", scope: "workspace", environmentId: "env" });
    pending.resolve([{ ...stored, url: "https://stale.example/" }]);
    await vi.waitFor(() => expect(latest().state).toBe("removed"));
    await Promise.resolve();
    expect(latest().url).toBe(ref.url);
    expect(ctx.run).toHaveBeenCalledOnce();
    created[0].messages.fire({ type: "run" });
    expect(ctx.run).toHaveBeenCalledOnce();
  });

  it("rejects an old URL lookup after a newer URL update", async () => {
    const ctx = setup();
    launchers.push(ctx.launcher);
    await ctx.launcher.show(ref);
    const pending = deferred<JenkinsEnvironment[]>();
    ctx.getEnvironments.mockImplementationOnce(() => pending.promise);
    ctx.changes.fire({ kind: "auth-config-updated", scope: "workspace", environmentId: "env" });
    const next = { ...stored, url: "https://current.example/" };
    ctx.setEnvironment(next);
    ctx.changes.fire({
      kind: "environment-updated",
      scope: "workspace",
      environmentId: "env",
      environment: next,
      urlChanged: true
    });
    await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledTimes(2));
    pending.resolve([{ ...stored, url: "https://old.example/" }]);
    await Promise.resolve();
    expect(latest().url).toBe(next.url);
    expect(ctx.run).toHaveBeenCalledTimes(2);
  });

  it("aborts an active request when the panel closes", async () => {
    const pending = deferred<EnvironmentDiagnosticsReport>();
    let signal: AbortSignal | undefined;
    const run = vi.fn(
      async (_ref: JenkinsEnvironmentRef, _id: number, nextSignal?: AbortSignal) => {
        signal = nextSignal;
        return pending.promise;
      }
    );
    const ctx = setup(run);
    launchers.push(ctx.launcher);
    const showing = ctx.launcher.show(ref);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    created[0].dispose();
    expect(signal?.aborted).toBe(true);
    pending.resolve(report());
    await showing;
  });
});
