import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { ExtensionTokenMap } from "../src/extension/container/ExtensionTokenMap";
import type { JenkinsEnvironmentStoreChange } from "../src/storage/JenkinsEnvironmentStore";
import * as vscodeStub from "./helpers/vscodeStub";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const info = vi.fn(async (_message: string) => undefined);
const error = vi.fn(async (_message: string) => undefined);
vi.doMock("vscode", () => ({
  ...vscodeStub,
  CodeActionKind: { QuickFix: "quickfix" },
  window: { showInformationMessage: info, showErrorMessage: error },
  commands: {
    registerCommand: (name: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(name, handler);
      return { dispose: () => handlers.delete(name) };
    }
  }
}));

const { registerJobCommands } = await import("../src/commands/JobCommands");
const { createRuntimeProviderCatalog } = await import(
  "../src/extension/providers/RuntimeProviders"
);
const { createExtensionContainer } = await import("../src/extension/container/ExtensionContainer");
const { MultibranchScanStateStore } = await import(
  "../src/services/multibranchScan/MultibranchScanState"
);

const subscriptions: vscode.Disposable[] = [];
const context = { subscriptions } as vscode.ExtensionContext;
const environment = { id: "local", scope: "workspace" as const, url: "https://ci.example/" };
const target = {
  environment: {
    environmentId: environment.id,
    scope: environment.scope,
    url: environment.url,
    name: undefined,
    username: undefined
  },
  folderUrl: `${environment.url}job/project/`,
  label: "project"
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const subscription of subscriptions.splice(0)) subscription.dispose();
});

function registerScanLogCommand(environments = [environment]) {
  const open = vi.fn(async () => undefined);
  const args = [
    context,
    {},
    { listEnvironmentsWithScope: async () => environments },
    {},
    {},
    {},
    { onDidRequestSubmit: () => ({ dispose() {} }) },
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    { open }
  ] as unknown as Parameters<typeof registerJobCommands>;
  registerJobCommands(...args);
  const handler = handlers.get("jenkinsWorkbench.viewMultibranchScanLog");
  assert.ok(handler);
  return { open, handler };
}

describe("multibranch scan command wiring", () => {
  it("requires a multibranch selection", async () => {
    const { open, handler } = registerScanLogCommand();
    await handler();
    await handler({ ...target, folderKind: "folder" });
    assert.equal(info.mock.calls.length, 2);
    assert.equal(open.mock.calls.length, 0);
  });

  it.each(["project", { label: "project" }, undefined])(
    "opens the selected folder with label %j and the current environment",
    async (label) => {
      const { open, handler } = registerScanLogCommand();
      await handler({ ...target, folderKind: "multibranch", label });
      assert.deepEqual(open.mock.calls, [
        [{ ...target, label: label ? "project" : "Multibranch" }]
      ]);
      assert.equal(error.mock.calls.length, 0);
    }
  );

  it("opens notification targets without a tree item", async () => {
    const { open, handler } = registerScanLogCommand();
    await handler(target);
    assert.deepEqual(open.mock.calls, [[target]]);
  });

  it("reports removed environments without opening a stale target", async () => {
    const { open, handler } = registerScanLogCommand([]);
    await handler(target);
    assert.equal(open.mock.calls.length, 0);
    assert.match(error.mock.calls[0][0], /environment no longer exists/);
  });
});

describe("multibranch scan runtime wiring", () => {
  it("stops tracking on removal, URL or TLS changes, but retains it for name and auth changes", () => {
    const changes = new vscodeStub.EventEmitter<JenkinsEnvironmentStoreChange>();
    const store = new MultibranchScanStateStore();
    subscriptions.push(changes, store);
    const catalog = createRuntimeProviderCatalog({
      context,
      extensionUri: vscodeStub.Uri.parse("file:///extension") as vscode.Uri,
      buildCompareOptionsProvider: () =>
        ({}) as ReturnType<
          Parameters<typeof createRuntimeProviderCatalog>[0]["buildCompareOptionsProvider"]
        >,
      currentBranchPullRequestJobNamePatterns: [],
      statusRefreshIntervalSeconds: 30,
      watchErrorThreshold: 5,
      queuePollIntervalSeconds: 30
    });
    const container = createExtensionContainer((registry) => {
      registry.register("dataService", () => ({}) as ExtensionTokenMap["dataService"]);
      registry.register("multibranchScanState", () => store);
      registry.register(
        "environmentStore",
        () =>
          ({
            onDidChange: changes.event
          }) as ExtensionTokenMap["environmentStore"]
      );
      registry.register("multibranchScanService", catalog.multibranchScanService);
    });
    const service = container.get("multibranchScanService");
    const stop = vi.spyOn(service, "stopEnvironment");
    for (const change of [
      { kind: "environment-updated", urlChanged: false, tlsPolicyChanged: false, environment },
      { kind: "auth-config-updated" }
    ] as const) {
      changes.fire({
        ...change,
        environmentId: "local",
        scope: "workspace"
      });
    }
    assert.equal(stop.mock.calls.length, 0);
    for (const change of [
      { kind: "environment-removed" },
      { kind: "environment-updated", urlChanged: true, tlsPolicyChanged: false, environment },
      { kind: "environment-updated", urlChanged: false, tlsPolicyChanged: true, environment }
    ] as const) {
      changes.fire({
        ...change,
        environmentId: "local",
        scope: "workspace"
      });
    }
    assert.equal(stop.mock.calls.length, 3);
    for (const [environmentId, reason] of stop.mock.calls) {
      assert.equal(environmentId, "local");
      assert.match(reason, /environment changed/);
    }
    stop.mockRestore();
  });
});
