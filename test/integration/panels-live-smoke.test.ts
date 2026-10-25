import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

function memoryMemento() {
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

async function waitFor(check: () => Promise<boolean> | boolean, message: string, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(message);
}

function assertPanelAssets(panel: vscode.WebviewPanel, name: string): void {
  assert.match(
    panel.webview.html,
    /<script type="module"[^>]+src="[^"]+"/,
    `${name} must load its bundled entry`
  );
  assert.doesNotMatch(
    panel.webview.html,
    /This panel couldn.t load|files are missing or damaged/,
    `${name} rendered an asset error`
  );
}

/** Opt-in end-to-end smoke checks run only against the repository's local fixture. */
describe("local Jenkins panel and refresh smoke", () => {
  (process.env.JENKINS_PANELS_LIVE ? it : it.skip)(
    "loads all five panels, updates tree/watch/queue, and previews and downloads artifacts",
    async function () {
      this.timeout(process.env.JENKINS_PANELS_MANUAL_SMOKE ? 300_000 : 150_000);
      const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
      assert.ok(extension);
      const load = (path: string) =>
        import(vscode.Uri.joinPath(extension.extensionUri, "out-test", "host", path).fsPath);
      const [
        { createExtensionContainer },
        { registerExtensionProviders },
        config,
        { NodeDetailsPanel },
        { NodeCapacityPanel },
        { BuildDetailsPanel },
        { BuildComparePanel },
        { HistoryController }
      ] = await Promise.all([
        load("extension/container/ExtensionContainer.js"),
        load("extension/ExtensionServices.js"),
        load("extension/ExtensionConfig.js"),
        load("panels/NodeDetailsPanel.js"),
        load("panels/NodeCapacityPanel.js"),
        load("panels/BuildDetailsPanel.js"),
        load("panels/BuildComparePanel.js"),
        load("panels/jobHistory/HistoryController.js")
      ]);
      const secrets = new Map<string, string>();
      const subscriptions: vscode.Disposable[] = [];
      const context = {
        extensionUri: extension.extensionUri,
        subscriptions,
        workspaceState: memoryMemento(),
        globalState: memoryMemento(),
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
          requestTimeoutMs: 15_000,
          statusRefreshIntervalSeconds: 10,
          watchErrorThreshold: 3,
          queuePollIntervalSeconds: 2,
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
      const url = process.env.JENKINS_PANELS_URL ?? "http://127.0.0.1:8080/";
      assert.ok(
        ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
        "Use only the local Jenkins fixture"
      );
      const environment = { environmentId: "panels-live-test", scope: "workspace", url };
      const store = container.get("environmentStore");
      await store.addEnvironment("workspace", { id: environment.environmentId, url });
      await store.setAuthConfig("workspace", environment.environmentId, {
        type: "basic",
        username: process.env.JENKINS_PANELS_USER ?? "admin",
        token: process.env.JENKINS_PANELS_TOKEN ?? "11decafbaddecafbaddecafbaddecafbad"
      });
      const data = container.get("dataService");
      const client = await container.get("clientProvider").getClient(environment);
      const history = container.get("historyService");
      const baseline = container.get("historyBaselineResolver");
      const watches = container.get("watchStore");
      const poller = container.get("poller");
      const queuePoller = container.get("queuePoller");
      const refreshHost = container.get("refreshHost");
      const provider = container.get("treeDataProvider");
      const successUrl = new URL("job/Workbench%20-%20Success/", url).href;
      const failureUrl = new URL("job/Workbench%20-%20Failure/", url).href;
      const slowUrl = new URL("job/Workbench%20-%20Slow%20Queue/", url).href;
      const ownedQueues: number[] = [];
      const ownedRunning = new Set<string>();
      // Capture server-held history state without changing any production module.
      const originalPost = HistoryController.prototype.post;
      const controllers = new Map<
        vscode.WebviewPanel,
        {
          model: {
            status: string;
            pausedReason?: string;
            revision: number;
            selectedBuild?: number;
            builds: Array<{ build: { number: number } }>;
            baseline?: { status: string; jobUrl?: string };
          };
          load: (refresh?: boolean) => Promise<void>;
          handle: (message: unknown) => Promise<void>;
        }
      >();
      HistoryController.prototype.post = function () {
        controllers.set(this.panel, this);
        return originalPost.call(this);
      };
      const originalHistoryLoad = history.load;
      let releaseHistory: (() => void) | undefined;
      const trigger = async (jobUrl: string, parameters?: URLSearchParams) => {
        const result = parameters
          ? await data.triggerBuildWithParameters(environment, jobUrl, parameters)
          : await data.triggerBuild(environment, jobUrl);
        assert.ok(result.queueLocation, "Jenkins must return a queue location");
        const match = new URL(result.queueLocation, url).pathname.match(/\/item\/(\d+)/);
        assert.ok(match);
        const queueId = Number(match[1]);
        ownedQueues.push(queueId);
        return queueId;
      };
      const runCompleted = async (jobUrl: string, parameters?: URLSearchParams) => {
        const queueId = await trigger(jobUrl, parameters);
        let buildUrl: string | undefined;
        await waitFor(async () => {
          const queued = await data.getQueueItem(environment, queueId);
          buildUrl = queued.executable?.url;
          if (buildUrl) ownedRunning.add(buildUrl);
          return Boolean(buildUrl);
        }, "Fixture build did not leave the queue");
        let result:
          | {
              number: number;
              url: string;
              result: string;
              building: boolean;
              artifacts: Array<{ relativePath: string }>;
            }
          | undefined;
        await waitFor(async () => {
          result = await data.getBuildDetails(environment, buildUrl);
          return result?.building === false;
        }, "Fixture build did not finish");
        assert.ok(result);
        ownedRunning.delete(result.url);
        return result;
      };
      try {
        // Seed concrete builds in ordinary fixture jobs; no extra setup script is required.
        const successParameters = () =>
          new URLSearchParams({
            GREETING: "Jenkins Workbench panel smoke",
            RUN_TESTS: "true",
            TARGET: "development"
          });
        const first = await runCompleted(successUrl, successParameters());
        assert.equal(first.result, "SUCCESS");
        const second = await runCompleted(successUrl, successParameters());
        assert.equal(second.result, "SUCCESS");
        const failure = await runCompleted(failureUrl);
        assert.equal(failure.result, "FAILURE");

        console.log("[panels-live] seed builds completed; checking watches");
        await watches.addWatch("workspace", {
          environmentId: environment.environmentId,
          jobUrl: successUrl,
          jobName: "Workbench - Success",
          jobKind: "pipeline"
        });
        await poller.poll();
        let watched = await watches.listWatchedJobs();
        assert.equal(watched[0].lastCompletedBuildNumber, second.number);
        assert.equal(watched[0].lastStatus, "success");

        console.log("[panels-live] watch state checked; loading tree");
        const roots = await provider.getChildren();
        const environmentItem = roots.find(
          (item: { contextValue?: string }) => item.contextValue === "environment"
        );
        assert.ok(environmentItem, "Configured environment must appear in the tree");
        const folders = await provider.getChildren(environmentItem);
        const nodesFolder = folders.find(
          (item: { contextValue?: string }) => item.contextValue === "nodes"
        );
        const queueFolder = folders.find(
          (item: { contextValue?: string }) => item.contextValue === "queueFolder"
        );
        assert.ok(nodesFolder);
        assert.ok(queueFolder);
        await waitFor(
          async () =>
            (await provider.getChildren(nodesFolder)).some((item: { contextValue?: string }) =>
              item.contextValue?.split(" ").includes("node")
            ),
          "Nodes tree did not load"
        );
        assert.equal(
          refreshHost.fullEnvironmentRefresh({ environmentId: environment.environmentId }).executed,
          true
        );
        assert.ok((await provider.getChildren()).length > 0);

        console.log("[panels-live] tree checked; exercising queued/running work");
        const slowQueueId = await trigger(slowUrl, new URLSearchParams({ SECONDS: "8" }));
        let slowBuildUrl: string | undefined;
        await waitFor(async () => {
          slowBuildUrl = (await data.getQueueItem(environment, slowQueueId)).executable?.url;
          if (slowBuildUrl) ownedRunning.add(slowBuildUrl);
          return Boolean(slowBuildUrl);
        }, "Slow fixture did not start");
        console.log("[panels-live] seed builds completed; checking watches");
        await watches.addWatch("workspace", {
          environmentId: environment.environmentId,
          jobUrl: slowUrl,
          jobName: "Workbench - Slow Queue",
          jobKind: "pipeline"
        });
        await poller.poll();
        watched = await watches.listWatchedJobs();
        assert.equal(
          watched.find((item: { jobUrl: string }) => item.jobUrl === slowUrl)?.lastIsBuilding,
          true
        );
        const secondSlowQueue = await trigger(slowUrl, new URLSearchParams({ SECONDS: "0" }));
        await waitFor(
          async () =>
            (await data.getQueueItems(environment)).some(
              (item: { id: number }) => item.id === secondSlowQueue
            ),
          "Pending build must be visible in queue data"
        );
        queuePoller.trackExpanded(environment);
        await waitFor(
          async () =>
            (await provider.getChildren(queueFolder)).some(
              (item: { queueId?: number }) => item.queueId === secondSlowQueue
            ),
          "Queue poller did not update the expanded queue tree"
        );
        await waitFor(
          async () => (await data.getBuildDetails(environment, slowBuildUrl)).building === false,
          "Slow build did not complete"
        );
        await waitFor(async () => {
          data.clearCacheForEnvironment(environment.environmentId);
          await poller.poll();
          watched = await watches.listWatchedJobs();
          return (
            watched.find((item: { jobUrl: string }) => item.jobUrl === slowUrl)?.lastIsBuilding ===
            false
          );
        }, "Watch did not observe completion of the queued builds");
        ownedRunning.delete(slowBuildUrl ?? "");
        queuePoller.trackCollapsed(environment);

        console.log("[panels-live] queue/watch completion checked; checking artifacts");
        const artifacts = second.artifacts;
        assert.ok(
          artifacts.some(
            (item: { relativePath: string }) => item.relativePath === "artifacts/message.txt"
          )
        );
        const artifact = await data.getArtifact(environment, second.url, "artifacts/message.txt");
        const previews = container.get("artifactPreviewProvider");
        const preview = previews.registerArtifact(artifact.data, "message.txt");
        assert.deepEqual(Buffer.from(previews.readFile(preview)), Buffer.from(artifact.data));
        const workspace = await mkdtemp(join(tmpdir(), "jenkins-panels-smoke-"));
        try {
          const downloaded = await container.get("artifactStorageService").downloadArtifact({
            environment,
            buildUrl: second.url,
            buildNumber: second.number,
            relativePath: "artifacts/message.txt",
            workspaceRoot: workspace,
            downloadRoot: "artifacts"
          });
          assert.deepEqual(await readFile(downloaded.targetPath), Buffer.from(artifact.data));
        } finally {
          await rm(workspace, { recursive: true, force: true });
        }

        console.log("[panels-live] opening Node Capacity");
        await NodeCapacityPanel.show({
          dataService: data,
          environment,
          extensionUri: extension.extensionUri,
          refreshHost
        });
        assert.equal(NodeCapacityPanel.currentPanel.hasRendered, true);
        assertPanelAssets(NodeCapacityPanel.currentPanel.panel, "Node Capacity");
        const nodes = await data.getNodes(environment);
        const nodeUrl = nodes[0]?.nodeUrl;
        assert.ok(nodeUrl);
        await NodeDetailsPanel.show({
          dataService: data,
          environment,
          nodeUrl,
          extensionUri: extension.extensionUri,
          refreshHost
        });
        assert.equal(NodeDetailsPanel.currentPanel.hasRendered, true);
        assert.ok(NodeDetailsPanel.currentPanel.lastDetails);
        assertPanelAssets(NodeDetailsPanel.currentPanel.panel, "Node Details");
        await container
          .get("buildComparePanelLauncher")
          .show({ environment, baselineBuildUrl: first.url, targetBuildUrl: second.url });
        assert.equal(BuildComparePanel.currentPanel.controller.canUpdateInPlace, true);
        assertPanelAssets(BuildComparePanel.currentPanel.panel, "Build Compare");
        await BuildComparePanel.currentPanel.swapBuilds();
        assert.equal(BuildComparePanel.currentPanel.serializedState.baselineBuildUrl, second.url);
        await container
          .get("buildDetailsPanelLauncher")
          .show({ environment, buildUrl: second.url });
        assert.equal(BuildDetailsPanel.currentPanel.controller.getCurrentDetails().url, second.url);
        assertPanelAssets(BuildDetailsPanel.currentPanel.panel, "Build Details");
        await BuildDetailsPanel.currentPanel.controller.refreshBuildDetails();
        assert.equal(
          BuildDetailsPanel.currentPanel.controller.getCurrentDetails().number,
          second.number
        );

        console.log("[panels-live] four panels loaded; opening Job History");
        const launcher = container.get("jobHistoryPanelLauncher");
        await launcher.show(environment, successUrl);
        const historyPanels = [...launcher.panels.values()] as vscode.WebviewPanel[];
        const successPanel = historyPanels.find(
          (panel) => panel.title === "History: Workbench - Success"
        );
        assert.ok(successPanel);
        assertPanelAssets(successPanel, "Job History");
        await waitFor(
          () => controllers.get(successPanel)?.model.status === "available",
          "Successful test history did not load"
        );
        const successController = controllers.get(successPanel);
        assert.ok(successController);
        assert.ok(successController.model.builds.length >= 2);
        await successController.handle({
          type: "historyAction",
          revision: successController.model.revision,
          action: "selectBuild",
          value: first.number
        });
        assert.equal(successController.model.selectedBuild, first.number);

        await baseline.store.set(environment, failureUrl, successUrl);
        await launcher.show(environment, failureUrl);
        const failurePanel = ([...launcher.panels.values()] as vscode.WebviewPanel[]).find(
          (panel) => panel.title === "History: Workbench - Failure"
        );
        assert.ok(failurePanel);
        await waitFor(
          () => controllers.get(failurePanel)?.model.baseline?.status === "available",
          "Selected baseline did not resolve"
        );
        assert.equal(controllers.get(failurePanel)?.model.baseline?.jobUrl, successUrl);

        await launcher.show(environment, successUrl);
        await waitFor(() => successPanel.visible, "History panel was not revealed");
        await waitFor(
          () => successController.model.status !== "loading",
          "History panel did not settle before cancellation check"
        );
        let pending: { active: () => boolean } | undefined;
        history.load = async function (request: { active: () => boolean }) {
          pending = request;
          await new Promise<void>((resolve) => {
            releaseHistory = resolve;
          });
          return originalHistoryLoad.call(this, request);
        };
        const hiddenLoad = successController.load(true);
        await waitFor(() => pending !== undefined, "History request did not start");
        console.log("[panels-live] opening Node Capacity");
        await NodeCapacityPanel.show({
          dataService: data,
          environment,
          extensionUri: extension.extensionUri,
          refreshHost
        });
        await waitFor(
          () => pending?.active() === false,
          "Hidden history request was not cancelled"
        );
        assert.equal(successController.model.status, "paused");
        assert.equal(successController.model.pausedReason, "hidden");
        history.load = originalHistoryLoad;
        releaseHistory?.();
        releaseHistory = undefined;
        await hiddenLoad;
        assert.equal(
          successController.model.status,
          "paused",
          "Cancelled response must not replace paused history"
        );
        await launcher.show(environment, successUrl);
        await waitFor(
          () => successController.model.status === "available",
          "History did not resume after reveal"
        );

        console.log(
          "[panels-live] all five panels, watch updates, queue refresh, artifact preview/download, baseline selection and hidden-history cancellation passed"
        );
        if (process.env.JENKINS_PANELS_MANUAL_SMOKE)
          await new Promise((resolve) => setTimeout(resolve, 120_000));
      } finally {
        history.load = originalHistoryLoad;
        releaseHistory?.();
        HistoryController.prototype.post = originalPost;
        queuePoller.dispose();
        poller.dispose();
        for (const id of ownedQueues) {
          try {
            await client.cancelQueueItem(id);
          } catch {
            /* Already started or completed. */
          }
        }
        for (const buildUrl of ownedRunning) {
          try {
            if ((await data.getBuildDetails(environment, buildUrl)).building)
              await data.stopBuild(environment, buildUrl);
          } catch {
            /* Completed or removed. */
          }
        }
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        for (const disposable of subscriptions.reverse()) disposable.dispose();
      }
    }
  );
});
