import * as assert from "node:assert/strict";
import * as vscode from "vscode";

describe("Job History webview", () => {
  it("mounts the compiled panel in the extension host with fixture history", async function () {
    this.timeout(process.env.JENKINS_HISTORY_MANUAL_SMOKE ? 150_000 : 15_000);
    const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
    assert.ok(extension);
    const load = (relative: string) =>
      import(vscode.Uri.joinPath(extension.extensionUri, "out", relative).fsPath);
    const [
      { HistoryController },
      { HistoryService },
      { resolveWebviewAssets, getWebviewAssetsRoot },
      { createTypedPanelRenderer },
      { createNonce }
    ] = await Promise.all([
      load("panels/jobHistory/HistoryController.js"),
      load("history/HistoryService.js"),
      load("panels/shared/webview/WebviewAssets.js"),
      load("panels/shared/webview/WebviewHtml.js"),
      load("panels/shared/webview/WebviewNonce.js")
    ]);
    const environment = {
      environmentId: "fixture",
      scope: "workspace",
      url: "https://jenkins.example/"
    };
    const jobUrl = `${environment.url}job/fixture/`;
    const builds = [43, 42, 41].map((number, index) => ({
      number,
      url: `${jobUrl}${number}/`,
      result: index === 1 ? "SUCCESS" : "FAILURE",
      timestamp: 1700000000000 - index * 100_000,
      duration: 18000 + index * 1000
    }));
    const getReport = (url: string) => ({
      suites: [
        {
          name: "ExampleSuite",
          cases: [
            {
              name: "newFailure",
              className: "ExampleTest",
              status: url.endsWith("43/") ? "FAILED" : "PASSED",
              age: url.endsWith("43/") ? 1 : 0,
              failedSince: url.endsWith("43/") ? 43 : 0
            },
            {
              name: "persistentFailure",
              className: "ExampleTest",
              status: "FAILED",
              age: 30,
              failedSince: 10
            },
            {
              name: "intermittentFailure",
              className: "ExampleTest",
              status: url.endsWith("42/") ? "PASSED" : "FAILED"
            }
          ]
        }
      ]
    });
    const data = {
      getBuildsForJob: async () => builds,
      getTestReport: async (_environment: unknown, url: string) => getReport(url)
    };
    const history = new HistoryService(data);
    const changes = new vscode.EventEmitter<void>();
    const panel = vscode.window.createWebviewPanel(
      "jenkinsWorkbench.historySmoke",
      "Job History fixture",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [getWebviewAssetsRoot(extension.extensionUri)]
      }
    );
    const controller = new HistoryController(panel, {
      data,
      history,
      environments: { onDidChange: changes.event },
      baseline: {
        resolve: async () => ({
          status: "available",
          label: "main",
          build: { number: 80, url: `${environment.url}job/main/80/`, timestamp: 1699999900000 },
          report: {
            status: "available",
            cases: [
              {
                key: JSON.stringify(["ExampleTest", "ExampleSuite", "persistentFailure"]),
                name: "persistentFailure",
                outcome: "failed"
              }
            ]
          }
        })
      },
      openBuild: async () => {},
      compare: async () => {},
      openJob: async () => {}
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Job History webview did not mount")), 10_000);
      panel.webview.onDidReceiveMessage((message) => {
        if (message?.type === "historyAction" && message.action === "ready") resolve();
      });
    });
    try {
      panel.webview.html = createTypedPanelRenderer("build").renderPanelHtml(
        {},
        {
          ...resolveWebviewAssets(panel.webview, extension.extensionUri, "jobHistory"),
          cspSource: panel.webview.cspSource,
          nonce: createNonce()
        }
      );
      controller.setContext(environment, jobUrl);
      await ready;
      if (process.env.JENKINS_HISTORY_MANUAL_SMOKE && !process.env.JENKINS_HISTORY_LIVE)
        await new Promise((resolve) => setTimeout(resolve, 120_000));
    } finally {
      clearTimeout(timeout);
      controller.dispose();
      history.dispose();
      changes.dispose();
      panel.dispose();
    }
  });
});
