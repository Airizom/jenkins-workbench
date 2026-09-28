import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import type { BuildCompareOptions } from "../src/panels/buildCompare/BuildCompareOptions";
import { BuildComparePanelController } from "../src/panels/buildCompare/BuildComparePanelController";
import { renderBuildCompareLoadErrorHtml } from "../src/panels/buildCompare/BuildComparePanelView";
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

describe("BuildComparePanelController.refresh", () => {
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
