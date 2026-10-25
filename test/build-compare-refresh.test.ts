import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { afterEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import type { BuildCompareOptions } from "../src/panels/buildCompare/BuildCompareOptions";
import { BuildComparePanelController } from "../src/panels/buildCompare/BuildComparePanelController";
import {
  BuildComparePanelView,
  renderBuildCompareLoadErrorHtml
} from "../src/panels/buildCompare/BuildComparePanelView";
import type { BuildCompareOutgoingMessage } from "../src/panels/buildCompare/shared/BuildComparePanelMessages";
import { createBuildComparePanelState } from "../src/panels/buildCompare/shared/BuildComparePanelWebviewState";
import type { BuildInspectionBackend } from "../src/panels/shared/backend/BuildInspectionBackend";

const ENVIRONMENT: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};
const BASELINE_URL = "https://jenkins.example/job/web-app/job/main/1/";
const TARGET_URL = "https://jenkins.example/job/web-app/job/main/2/";
const OPTIONS: BuildCompareOptions = {
  console: { maxBytes: 1024, maxLines: 100 },
  parameterRedaction: { allowList: [], denyList: [], maskPatterns: [], maskValue: "***" }
};

function createPanel() {
  const posted: unknown[] = [];
  let html = "";
  const panel = {
    title: "",
    webview: {
      cspSource: "vscode-resource:",
      get html() {
        return html;
      },
      set html(value: string) {
        html = value;
      },
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    }
  };
  return { panel: panel as unknown as vscode.WebviewPanel, posted, getHtml: () => html };
}

function createBackend(failDetails: () => boolean): BuildInspectionBackend {
  return {
    status: {
      getBuildDetails: async (_environment: JenkinsEnvironmentRef, buildUrl: string) => {
        if (failDetails()) {
          throw new Error("HTTP 503");
        }
        const number = buildUrl === BASELINE_URL ? 1 : 2;
        return {
          number,
          url: buildUrl,
          fullDisplayName: `web-app » main #${number}`
        } satisfies JenkinsBuildDetails;
      },
      getWorkflowRun: async () => undefined
    },
    tests: { getTestReport: async () => undefined },
    console: {
      getConsoleTextProgressive: async () => ({
        text: "",
        textSize: 0,
        moreData: false,
        bytesRead: 0
      }),
      getConsoleTextHead: async () => ({ text: "", truncated: false })
    }
  } as unknown as BuildInspectionBackend;
}

const panelState = createBuildComparePanelState(ENVIRONMENT, BASELINE_URL, TARGET_URL);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function loadWithPendingConsole() {
  const { panel, posted } = createPanel();
  const controller = new BuildComparePanelController(panel, {} as vscode.Uri);
  const backend = createBackend(() => false);
  const consoleRequest =
    createDeferred<
      Awaited<ReturnType<BuildInspectionBackend["console"]["getConsoleTextProgressive"]>>
    >();
  vi.spyOn(backend.console, "getConsoleTextProgressive").mockReturnValueOnce(
    consoleRequest.promise
  );
  vi.spyOn(BuildComparePanelView.prototype, "resolveAssetsAndRenderLoading").mockReturnValue({
    scriptUri: "",
    styleUris: []
  });
  vi.spyOn(BuildComparePanelView.prototype, "renderModel").mockImplementation(() => {});
  assert.deepEqual(await controller.load(backend, OPTIONS, ENVIRONMENT, BASELINE_URL, TARGET_URL), {
    status: "ok"
  });
  assert.equal(controller.canUpdateInPlace, true);
  assert.equal(posted.length, 0);
  const completeConsole = async () => {
    consoleRequest.resolve({
      text: "baseline only\n",
      textSize: 14,
      bytesRead: 14,
      moreData: false
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return { controller, backend, posted, completeConsole };
}

describe("BuildComparePanelController.refresh", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["before", "after"])(
    "keeps the initial console result when it finishes %s refresh failure",
    async (completionOrder) => {
      const { controller, backend, posted, completeConsole } = await loadWithPendingConsole();
      const refreshDetails = createDeferred<JenkinsBuildDetails>();
      vi.spyOn(backend.status, "getBuildDetails").mockReturnValue(refreshDetails.promise);
      const refresh = controller.refresh(backend, OPTIONS, ENVIRONMENT, BASELINE_URL, TARGET_URL, {
        panelState
      });
      const failure = assert.rejects(refresh, /HTTP 503/);

      if (completionOrder === "before") {
        await completeConsole();
      }
      refreshDetails.reject(new Error("HTTP 503"));
      await failure;
      if (completionOrder === "after") {
        await completeConsole();
      }

      const messages = posted as BuildCompareOutgoingMessage[];
      assert.equal(messages.filter((message) => message.type === "updateBuildCompare").length, 0);
      assert.equal(
        messages.filter((message) => message.type === "buildCompareRefreshFailed").length,
        1
      );
      const updates = messages.filter((message) => message.type === "updateConsoleSection");
      assert.equal(updates.length, 1);
      assert.equal(updates[0].console.status, "available");
      await controller.handleWebviewReady();
      assert.deepEqual(posted.at(-1), updates[0]);
    }
  );

  it("discards the initial console result after a successful replacement", async () => {
    const { controller, backend, posted, completeConsole } = await loadWithPendingConsole();
    assert.equal(
      await controller.refresh(backend, OPTIONS, ENVIRONMENT, BASELINE_URL, TARGET_URL, {
        panelState
      }),
      true
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const messages = posted as BuildCompareOutgoingMessage[];
    const updates = messages.filter((message) => message.type === "updateConsoleSection");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].console.status, "identical");

    const messageCount = posted.length;
    await completeConsole();
    assert.equal(posted.length, messageCount);
    await controller.handleWebviewReady();
    assert.deepEqual(posted.at(-1), updates[0]);
  });

  it("posts the new comparison instead of reloading the webview", async () => {
    const { panel, posted, getHtml } = createPanel();
    const controller = new BuildComparePanelController(panel, {} as vscode.Uri);

    const applied = await controller.refresh(
      createBackend(() => false),
      OPTIONS,
      ENVIRONMENT,
      BASELINE_URL,
      TARGET_URL,
      { panelState }
    );

    assert.equal(applied, true);
    assert.equal(getHtml(), "");
    const update = posted[0] as { type: string; model: { target: Record<string, unknown> } };
    assert.equal(update.type, "updateBuildCompare");
    assert.equal(update.model.target.buildNumberLabel, "#2");
    assert.equal(update.model.target.jobDisplayName, "web-app » main");
    assert.deepEqual((posted[0] as { panelState: unknown }).panelState, panelState);
  });

  it("reports refresh failures inline and keeps the rendered page", async () => {
    const { panel, posted, getHtml } = createPanel();
    const controller = new BuildComparePanelController(panel, {} as vscode.Uri);

    await assert.rejects(
      controller.refresh(
        createBackend(() => true),
        OPTIONS,
        ENVIRONMENT,
        BASELINE_URL,
        TARGET_URL,
        {
          panelState
        }
      )
    );

    assert.equal(getHtml(), "");
    assert.equal(posted.length, 1);
    const failure = posted[0] as { type: string; message: string };
    assert.equal(failure.type, "buildCompareRefreshFailed");
    assert.match(failure.message, /HTTP 503/);
  });
});

describe("renderBuildCompareLoadErrorHtml", () => {
  it("offers a nonce-gated Retry that posts a refresh message and escapes the error", () => {
    const html = renderBuildCompareLoadErrorHtml({
      cspSource: "vscode-resource:",
      nonce: "abc123",
      message: "Failed <script>alert(1)</script>",
      panelState
    });

    assert.match(html, /<button type="button" id="build-compare-retry">Retry<\/button>/);
    assert.match(html, /<script nonce="abc123">/);
    assert.match(html, /"type":"refreshBuildCompare"/);
    assert.match(html, /Failed &lt;script&gt;/);
    assert.match(html, /setState\?\.\(\{"environmentId":"env-1"/);
  });
});
