import * as assert from "node:assert/strict";
import * as vscode from "vscode";

/** Opt-in destructive checks use only uniquely named nodes on the local fixture. */
describe("local Jenkins node management", () => {
  (process.env.JENKINS_NODE_LIVE ? it : it.skip)(
    "creates, edits, copies, inspects logs and deletes permanent agents",
    async function () {
      this.timeout(process.env.JENKINS_NODE_MANUAL_SMOKE ? 300_000 : 90_000);
      const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
      assert.ok(extension);
      const load = (path: string) =>
        import(vscode.Uri.joinPath(extension.extensionUri, "out-test", "host", path).fsPath);
      const [
        { JenkinsClient },
        { JenkinsDataService },
        { NodeDetailsPanel },
        { NodeCapacityPanel }
      ] = await Promise.all([
        load("jenkins/JenkinsClient.js"),
        load("jenkins/JenkinsDataService.js"),
        load("panels/NodeDetailsPanel.js"),
        load("panels/NodeCapacityPanel.js")
      ]);
      const url = process.env.JENKINS_NODE_URL ?? "http://127.0.0.1:8080/";
      assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
      const client = new JenkinsClient({
        baseUrl: url,
        username: process.env.JENKINS_NODE_USER ?? "admin",
        token: process.env.JENKINS_NODE_TOKEN ?? "11decafbaddecafbaddecafbaddecafbad",
        requestTimeoutMs: 15_000
      });
      const data = new JenkinsDataService(
        { getClient: async () => client, getAuthSignature: async () => "local-node-fixture" },
        {
          cacheTtlMs: 1000,
          buildParameterRequestPreparer: {
            prepareBuildParameters: async () => ({ hasParameters: false })
          }
        }
      );
      const environment = { environmentId: "node-live", scope: "workspace", url };
      const name = `workbench-node-validation-${Date.now()}`;
      const copyName = `${name}-copy`;
      const nodeUrl = new URL(`computer/${name}/`, url).href;
      const copyUrl = new URL(`computer/${copyName}/`, url).href;
      try {
        const created = await data.createNode(environment, {
          name,
          remoteFS: `/tmp/${name}`,
          numExecutors: 1,
          labels: 'linux "quoted label"',
          mode: "EXCLUSIVE",
          description: "Node management integration fixture"
        });
        assert.equal(created.status, "created");
        assert.equal(created.nodeUrl, nodeUrl);
        assert.deepEqual(await data.getNodeConfiguration(environment, nodeUrl), {
          name,
          labels: 'linux "quoted label"'
        });
        await assert.rejects(
          () =>
            data.createNode(environment, {
              name,
              remoteFS: "/tmp/duplicate",
              numExecutors: 1,
              labels: "",
              mode: "NORMAL"
            }),
          /already exists/
        );

        const before = await client.getNodeConfigXml(nodeUrl);
        assert.equal(
          (
            await data.updateNodeLabels(
              environment,
              nodeUrl,
              'Windows "quoted label"',
              'linux "quoted label"'
            )
          ).status,
          "updated"
        );
        const after = await client.getNodeConfigXml(nodeUrl);
        assert.equal(
          before.replace(/<label>[\s\S]*?<\/label>/, "<label/>"),
          after.replace(/<label>[\s\S]*?<\/label>/, "<label/>")
        );
        assert.equal(
          (await data.updateNodeLabels(environment, nodeUrl, "lost update", 'linux "quoted label"'))
            .status,
          "conflict"
        );
        assert.equal(
          (await data.updateNodeLabels(environment, nodeUrl, "", 'Windows "quoted label"')).status,
          "updated"
        );
        const details = await data.getNodeDetails(environment, nodeUrl, { mode: "refresh" });
        assert.ok(details.assignedLabels.some((label: { name?: string }) => label.name === name));
        assert.equal((await data.disconnectNodeAgent(environment, nodeUrl)).status, "no_change");

        const copied = await data.copyNode(environment, nodeUrl, copyName);
        assert.equal(copied.status, "copied");
        assert.deepEqual(await data.getNodeConfiguration(environment, copyUrl), {
          name: copyName,
          labels: ""
        });
        const log = await data.getNodeAgentLog(environment, nodeUrl);
        assert.ok(Buffer.byteLength(log.text, "utf8") <= 64 * 1024);
        assert.ok(Number.isSafeInteger(log.nextStart));
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(() =>
          data.getNodeAgentLog(environment, nodeUrl, { signal: controller.signal })
        );

        await NodeCapacityPanel.show({
          dataService: data,
          environment,
          extensionUri: extension.extensionUri
        });
        await NodeDetailsPanel.show({
          dataService: data,
          environment,
          nodeUrl,
          initialTab: "agentLog",
          extensionUri: extension.extensionUri
        });
        assert.ok(NodeDetailsPanel.currentPanel);
        if (process.env.JENKINS_NODE_MANUAL_SMOKE) {
          await new Promise((resolve) => setTimeout(resolve, 120_000));
        }
        await assert.rejects(() =>
          data.getNodeConfiguration(environment, new URL("computer/(built-in)/", url).href)
        );
        await data.checkNodeDeletion(environment, copyUrl);
        await data.deleteNode(environment, copyUrl);
        await data.deleteNode(environment, nodeUrl);
        NodeDetailsPanel.closeForNode(environment, nodeUrl);
        assert.equal(NodeDetailsPanel.currentPanel, undefined);
        const nodes = await data.getNodes(environment, { mode: "refresh" });
        assert.ok(
          !nodes.some((node: { displayName: string }) =>
            [name, copyName].includes(node.displayName)
          )
        );
      } finally {
        NodeDetailsPanel.closeForNode(environment, nodeUrl);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        // Clean up only this test's names if an earlier assertion failed.
        for (const target of [copyUrl, nodeUrl]) {
          try {
            await client.deleteNode(target);
          } catch {
            /* Already removed. */
          }
        }
      }
    }
  );
});
