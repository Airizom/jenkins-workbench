import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

function memento() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => values.get(key) ?? fallback,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    keys: () => [...values.keys()],
    setKeysForSync: () => {}
  };
}
async function until(check: () => Promise<boolean> | boolean, message: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(message);
}

describe("local Jenkins history", () => {
  (process.env.JENKINS_HISTORY_LIVE ? it : it.skip)(
    "validates real reports, baseline timing and all five panels",
    async function () {
      this.timeout(process.env.JENKINS_HISTORY_MANUAL_SMOKE ? 360_000 : 60_000);
      const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
      assert.ok(extension);
      const load = (relative: string) =>
        import(vscode.Uri.joinPath(extension.extensionUri, "out", relative).fsPath);
      const [
        { createExtensionContainer },
        { registerExtensionProviders },
        config,
        analysis,
        { NodeDetailsPanel },
        { NodeCapacityPanel }
      ] = await Promise.all([
        load("extension/container/ExtensionContainer.js"),
        load("extension/ExtensionServices.js"),
        load("extension/ExtensionConfig.js"),
        load("history/HistoryAnalysis.js"),
        load("panels/NodeDetailsPanel.js"),
        load("panels/NodeCapacityPanel.js")
      ]);
      const secrets = new Map<string, string>();
      const subscriptions: vscode.Disposable[] = [];
      const context = {
        extensionUri: extension.extensionUri,
        subscriptions,
        workspaceState: memento(),
        globalState: memento(),
        extensionMode: vscode.ExtensionMode.Test,
        secrets: {
          get: async (key: string) => secrets.get(key),
          store: async (key: string, value: string) => {
            secrets.set(key, value);
          },
          delete: async (key: string) => {
            secrets.delete(key);
          }
        }
      };
      const settings = config.getExtensionConfiguration();
      const container = createExtensionContainer((registry: unknown) =>
        registerExtensionProviders(registry, context, {
          extensionUri: extension.extensionUri,
          cacheTtlMs: 1000,
          maxCacheEntries: 200,
          requestTimeoutMs: 15000,
          statusRefreshIntervalSeconds: 10,
          watchErrorThreshold: 3,
          queuePollIntervalSeconds: 10,
          buildTooltipOptions: config.getBuildTooltipOptions(settings),
          buildListFetchOptions: config.getBuildListFetchOptions(settings),
          treeViewCurationOptions: config.getTreeViewCurationOptions(settings),
          activityOptions: config.getTreeActivityOptions(settings),
          artifactActionOptionsProvider: () => ({ downloadRoot: "artifacts" }),
          artifactPreviewOptionsProvider: () => ({ maxBytes: 1_000_000 }),
          artifactPreviewCacheOptions: { maxEntries: 20, maxTotalBytes: 1_000_000, ttlMs: 60_000 },
          buildCompareOptionsProvider: () => config.getBuildCompareOptions(settings),
          currentBranchPullRequestJobNamePatterns:
            config.getCurrentBranchPullRequestJobNamePatterns(settings),
          jenkinsfileIntelligenceConfig: config.getJenkinsfileIntelligenceConfig(settings),
          jenkinsfileValidationConfig: config.getJenkinsfileValidationConfig(settings)
        })
      );
      const url = process.env.JENKINS_HISTORY_URL ?? "http://127.0.0.1:8080/";
      assert.ok(
        ["127.0.0.1", "localhost"].includes(new URL(url).hostname),
        "Live fixture tests must use a local Jenkins instance"
      );
      const environment = { environmentId: "history-live-test", scope: "workspace", url };
      const store = container.get("environmentStore");
      await store.addEnvironment("workspace", { id: environment.environmentId, url });
      await store.setAuthConfig("workspace", environment.environmentId, {
        type: "basic",
        username: process.env.JENKINS_HISTORY_USER ?? "admin",
        token: process.env.JENKINS_HISTORY_TOKEN ?? "11decafbaddecafbaddecafbaddecafbad"
      });
      const data = container.get("dataService");
      const history = container.get("historyService");
      const baseline = container.get("historyBaselineResolver");
      const jobUrl = new URL("job/Workbench%20History%20Validation/job/feature/", url).href;
      const request = { environment, jobUrl, count: 20, active: () => true };
      try {
        const result = await history.load(request);
        assert.ok(result.builds.length >= 3, "Run dev/jenkins/history-validation.groovy first");
        const target = result.builds[0];
        const tests = analysis.analyzeTests(result.builds);
        const intermittent = tests.find((test: { name: string }) => test.name === "intermittent");
        assert.equal(intermittent?.intermittent, true);
        const fresh = target.report.cases.find(
          (test: { name: string }) => test.name === "newFailure"
        );
        const persistent = target.report.cases.find(
          (test: { name: string }) => test.name === "persistent"
        );
        assert.equal(analysis.failureEvidence(fresh, target.build.number).kind, "new");
        assert.equal(analysis.failureEvidence(persistent, target.build.number).kind, "continuing");
        const base = await baseline.resolve(request, target.build);
        assert.equal(base.label, "main");
        assert.equal(base.status, "available");
        assert.ok(base.build.timestamp + base.build.duration <= target.build.timestamp);
        assert.equal(
          base.report.cases.find((test: { name: string }) => test.name === "persistent")?.outcome,
          "failed"
        );
        const historical = await history.load({ ...request, anchor: result.builds[1].build });
        assert.ok(
          historical.builds.every(
            (item: { build: { number: number } }) =>
              item.build.number <= result.builds[1].build.number
          )
        );
        const withoutTests = await history.load({
          ...request,
          jobUrl: new URL("job/Workbench%20-%20Failure/", url).href
        });
        assert.ok(withoutTests.builds.length > 0);
        assert.equal(withoutTests.builds[0].report.status, "unavailable");
        const capJobUrl = new URL("job/Workbench%20History%20Lookup%20Cap/", url).href;
        const oldBuild = await data.getBuildDetails(environment, `${capJobUrl}1/`);
        const capped = await history.load({ ...request, jobUrl: capJobUrl, anchor: oldBuild });
        assert.equal(capped.truncated, true);
        assert.equal(capped.builds.length, 1);
        assert.equal(capped.builds[0].build.number, 1);
        const compact = await data.getTestReport(environment, target.build.url, {
          projection: "history"
        });
        assert.equal(compact.suites[0].cases[0].errorDetails, undefined);
        assert.ok(compact.suites[0].name);
        const artifact = await data.getArtifact(environment, target.build.url, "artifact.txt");
        assert.ok(Buffer.from(artifact.data).toString().includes("History validation artifact"));
        const previews = container.get("artifactPreviewProvider");
        const previewUri = previews.registerArtifact(artifact.data, "artifact.txt");
        assert.equal(
          Buffer.from(previews.readFile(previewUri)).toString(),
          Buffer.from(artifact.data).toString()
        );
        const downloadWorkspace = await mkdtemp(join(tmpdir(), "jenkins-history-download-"));
        try {
          const saved = await container.get("artifactStorageService").downloadArtifact({
            environment,
            buildUrl: target.build.url,
            buildNumber: target.build.number,
            relativePath: "artifact.txt",
            workspaceRoot: downloadWorkspace,
            downloadRoot: "artifacts"
          });
          assert.equal(
            await readFile(saved.targetPath, "utf8"),
            Buffer.from(artifact.data).toString()
          );
        } finally {
          await rm(downloadWorkspace, { recursive: true, force: true });
        }
        const queues = await data.getQueueItems(environment);
        assert.ok(Array.isArray(queues));
        const roots = await data.getJobCollection(environment, { scope: { kind: "root" } });
        assert.ok(roots.length > 0);
        data.clearCache();
        assert.ok(
          (await data.getJobCollection(environment, { scope: { kind: "root" } })).length > 0
        );
        await NodeCapacityPanel.show({
          dataService: data,
          environment,
          extensionUri: extension.extensionUri
        });
        const nodes = await data.getNodes(environment);
        assert.ok(nodes.length > 0);
        const { resolveNodeUrl } = await load("jenkins/urls.js");
        const nodeUrl = resolveNodeUrl(url, nodes[0]);
        assert.ok(nodeUrl);
        await NodeDetailsPanel.show({
          dataService: data,
          environment,
          nodeUrl,
          extensionUri: extension.extensionUri
        });
        await container.get("buildComparePanelLauncher").show({
          environment,
          baselineBuildUrl: result.builds[1].build.url,
          targetBuildUrl: target.build.url
        });
        await container
          .get("buildDetailsPanelLauncher")
          .show({ environment, buildUrl: target.build.url });
        await container.get("jobHistoryPanelLauncher").show(environment, jobUrl);
        const provider = container.get("treeDataProvider");
        assert.ok((await provider.getChildren()).length > 0);
        provider.refresh();
        assert.ok((await provider.getChildren()).length > 0);
        if (process.env.JENKINS_HISTORY_LIVE_COMPLETION) {
          const watches = container.get("watchStore");
          await watches.addWatch("workspace", {
            environmentId: environment.environmentId,
            jobUrl,
            jobName: "History validation",
            jobKind: "pipeline"
          });
          const poller = container.get("poller");
          await poller.poll();
          const trigger = await data.triggerBuildWithParameters(
            environment,
            jobUrl,
            new URLSearchParams({ DELAY_SECONDS: "12" })
          );
          assert.ok(trigger.queueLocation);
          let running: { number: number; url: string; building: boolean } | undefined;
          await until(async () => {
            const builds = await data.getBuildsForJob(environment, jobUrl, 1, {
              bypassCache: true
            });
            running = builds[0];
            return Boolean(running && running.number > target.build.number && running.building);
          }, "Validation build did not start");
          assert.ok(running);
          await container
            .get("buildDetailsPanelLauncher")
            .show({ environment, buildUrl: running.url });
          await data.triggerBuildWithParameters(
            environment,
            jobUrl,
            new URLSearchParams({ DELAY_SECONDS: "0" })
          );
          await until(
            async () =>
              (await data.getQueueItems(environment)).some(
                (item: { taskUrl?: string }) => item.taskUrl === jobUrl
              ),
            "Second validation build was not visible in the queue"
          );
          const { BuildDetailsPanel } = await load("panels/BuildDetailsPanel.js");
          await until(
            () => {
              const panel = BuildDetailsPanel.currentPanel;
              return (
                panel?.controller.getCurrentDetails()?.building === false &&
                panel.historyController?.model.builds[0]?.build.number === running?.number &&
                panel.historyController?.model.status !== "loading"
              );
            },
            "Visible completion did not load failure history",
            45_000
          );
          await poller.poll();
          const watched = await watches.listWatchedJobs();
          assert.ok(watched[0].lastCompletedBuildNumber >= running.number);
          poller.dispose();
        }
        if (process.env.JENKINS_HISTORY_MANUAL_SMOKE)
          await new Promise((resolve) => setTimeout(resolve, 300_000));
      } finally {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        for (const disposable of subscriptions.reverse()) disposable.dispose();
      }
    }
  );
});
