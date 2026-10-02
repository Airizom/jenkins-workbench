import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { renderLoadingSkeletonHtml } from "../src/panels/shared/webview/LoadingSkeletonHtml";
import * as vscodeStub from "./helpers/vscodeStub";

const executedCommands: string[] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  commands: {
    executeCommand: async (command: string) => {
      executedCommands.push(command);
      return undefined;
    }
  }
}));

const {
  assignWebviewPanelManifestErrorHtml,
  createMissingPanelAssetsMessages,
  renderPanelLoadingHtml,
  renderPanelRestoreErrorHtml
} = await import("../src/panels/shared/webview/WebviewHtml");

type MessageListener = (message: unknown) => void;

function createFakePanel() {
  const listeners: MessageListener[] = [];
  const disposeListeners: Array<() => void> = [];
  const panel = {
    webview: {
      html: "",
      cspSource: "vscode-resource:",
      onDidReceiveMessage: (listener: MessageListener) => {
        listeners.push(listener);
        return {
          dispose: () => {
            listeners.splice(listeners.indexOf(listener), 1);
          }
        };
      }
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: () => {} };
    }
  };
  return {
    panel,
    listeners,
    post: (message: unknown) => {
      for (const listener of [...listeners]) {
        listener(message);
      }
    },
    dispose: () => {
      for (const listener of disposeListeners) {
        listener();
      }
    }
  };
}

describe("panel load-error view", () => {
  it("renders missing assets as a user-facing alert with developer details", () => {
    const html = renderPanelRestoreErrorHtml("vscode-resource:", {
      ...createMissingPanelAssetsMessages({ title: "Build Details", panelLabel: "Build details" }),
      nonce: "abc",
      styleUris: []
    });

    assert.match(html, /<main class="jenkins-workbench-panel-message" role="alert">/);
    assert.match(html, /<p class="jw-eyebrow">Build Details<\/p>/);
    assert.match(html, /<h1>This panel couldn&#39;t load<\/h1>/);
    assert.match(html, /missing or damaged/);
    assert.match(html, /reinstall Jenkins Workbench/);
    assert.match(
      html,
      /<button type="button" id="jw-reload-window" hidden>Reload Window<\/button>/
    );
    assert.match(
      html,
      /<details><summary>Developer details<\/summary><p>[^<]*npm run compile[^<]*<\/p><\/details>/
    );
    // The developer command stays out of the user-facing copy.
    assert.doesNotMatch(html.split("<details>")[0] ?? "", /npm run compile/);
    assert.match(html, /<script nonce="abc">/);
    assert.match(html, /postMessage\(\{ type: "jenkinsWorkbench.reloadWindow" \}\)/);
  });

  it("escapes caller text and omits the reload action and details by default", () => {
    const html = renderPanelRestoreErrorHtml("vscode-resource:", {
      nonce: "abc",
      title: "<Title>",
      message: "HTTP 500 <script>alert(1)</script>",
      hint: "Reopen & retry",
      styleUris: []
    });

    assert.match(html, /<h1>&lt;Title&gt;<\/h1>/);
    assert.match(html, /HTTP 500 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /Reopen &amp; retry/);
    assert.doesNotMatch(html, /jw-reload-window/);
    assert.doesNotMatch(html, /<details>/);
    assert.doesNotMatch(html, /<script/);
  });

  it("restores panel state with a single acquireVsCodeApi call", () => {
    const html = renderPanelRestoreErrorHtml("vscode-resource:", {
      ...createMissingPanelAssetsMessages({ title: "Node Details", panelLabel: "Node details" }),
      nonce: "abc",
      styleUris: [],
      panelState: { nodeUrl: "https://jenkins.example/computer/a/" }
    });

    assert.equal(html.match(/acquireVsCodeApi\(\)/g)?.length, 1);
    assert.match(
      html,
      /vscodeApi\.setState\(\{"nodeUrl":"https:\/\/jenkins.example\/computer\/a\/"\}\)/
    );
  });

  it("reloads the window from the error page button and registers the handler once", () => {
    const fake = createFakePanel();
    const options = createMissingPanelAssetsMessages({
      title: "Node Capacity",
      panelLabel: "Node capacity"
    });
    const panel = fake.panel as unknown as Parameters<
      typeof assignWebviewPanelManifestErrorHtml
    >[0];
    const extensionUri = { fsPath: "" } as Parameters<
      typeof assignWebviewPanelManifestErrorHtml
    >[1];

    assignWebviewPanelManifestErrorHtml(panel, extensionUri, "nodeCapacity", options);
    assignWebviewPanelManifestErrorHtml(panel, extensionUri, "nodeCapacity", options);

    assert.equal(fake.listeners.length, 1);
    assert.match(fake.panel.webview.html, /Reload Window/);

    executedCommands.length = 0;
    fake.post({ type: "refresh" });
    fake.post({ type: "jenkinsWorkbench.reloadWindow" });
    assert.deepEqual(executedCommands, ["workbench.action.reloadWindow"]);

    fake.dispose();
    assert.equal(fake.listeners.length, 0);
  });

  it("does not register a reload handler for restore errors", () => {
    const fake = createFakePanel();
    assignWebviewPanelManifestErrorHtml(
      fake.panel as unknown as Parameters<typeof assignWebviewPanelManifestErrorHtml>[0],
      { fsPath: "" } as Parameters<typeof assignWebviewPanelManifestErrorHtml>[1],
      "buildDetails",
      { title: "Build Details", message: "Could not restore.", hint: "Reopen it." }
    );

    assert.equal(fake.listeners.length, 0);
    assert.doesNotMatch(fake.panel.webview.html, /jw-reload-window/);
  });
});

describe("server-rendered loading skeleton", () => {
  it.each(["build", "node", "capacity", "compare"] as const)(
    "exposes a polite loading status for %s panels",
    (variant) => {
      const html = renderPanelLoadingHtml(
        { cspSource: "vscode-resource:", nonce: "abc", styleUris: [] },
        variant
      );

      assert.match(html, /<div role="status" aria-live="polite" aria-label="Loading"/);
      assert.match(html, /<span class="sr-only">Loading…<\/span>/);
    }
  );
});

describe("loading skeleton layouts", () => {
  const render = (variant: Parameters<typeof renderLoadingSkeletonHtml>[0]) =>
    renderLoadingSkeletonHtml(variant);

  it("gives Node Capacity its own header, six summary cards, and pool cards", () => {
    const html = render("capacity");
    assert.notEqual(html, render("node"));
    assert.match(html, /class="panel-header"/);
    assert.equal(html.match(/rounded-lg border border-border bg-card px-3 py-2\.5/g)?.length, 6);
    assert.equal(html.match(/rounded-lg border border-border bg-card px-4 py-3/g)?.length, 3);
    assert.doesNotMatch(html, /border-b border-border">\s*<div class="flex w-full flex-nowrap/);
  });

  it("matches the Node Details hero: not sticky, 40px icon, utilization row", () => {
    const html = render("node");
    assert.doesNotMatch(html, /sticky-header/);
    assert.match(html, /h-10 w-10/);
    assert.match(html, /max-w-\[280px\]/);
    assert.match(html, /md:grid-cols-2/);
  });

  it("matches the Build Details hero and stage strip", () => {
    const html = render("build");
    assert.match(html, /sticky-header/);
    assert.match(html, /h-10 w-10 shrink-0 rounded-xl/);
    assert.equal(html.match(/h-6 flex-1 max-w-\[150px\]/g)?.length, 5);
  });
});
