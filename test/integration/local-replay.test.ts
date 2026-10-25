import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";

type Payload = { mainScript: string; loadedScripts: Array<{ postField: string; script: string }> };

async function modules() {
  const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
  assert.ok(extension);
  const load = (relative: string) =>
    import(vscode.Uri.joinPath(extension.extensionUri, "out-test", "host", relative).fsPath);
  const [resolver, matcher, workflow, client, waiter] = await Promise.all([
    load("commands/build/LocalJenkinsfileResolver.js"),
    load("validation/JenkinsfileMatcher.js"),
    load("commands/build/LocalJenkinsfileReplayWorkflow.js"),
    load("jenkins/JenkinsClient.js"),
    load("services/QueuedBuildWaiter.js")
  ]);
  return { ...resolver, ...matcher, ...workflow, ...client, ...waiter };
}

async function until(check: () => Promise<boolean> | boolean, message: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

async function replaceText(document: vscode.TextDocument, text: string) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    text
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

async function withJenkinsfile(
  run: (
    document: vscode.TextDocument,
    other: vscode.TextDocument,
    diskText: string
  ) => Promise<void>
) {
  assert.ok(
    vscode.workspace.workspaceFolders?.length,
    "The integration host must open a workspace"
  );
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
  assert.equal(workspaceRoot.scheme, "file", "The integration workspace must use local files");
  const root = await mkdtemp(join(workspaceRoot.fsPath, ".workbench-local-replay-"));
  const rootUri = vscode.Uri.file(root);
  const diskText = "pipeline { agent any; stages { stage('Saved') { steps { echo 'saved' } } } }\n";
  const sourceUri = vscode.Uri.joinPath(rootUri, "Jenkinsfile");
  const otherUri = vscode.Uri.joinPath(rootUri, "Other.Jenkinsfile");
  await writeFile(sourceUri.fsPath, diskText);
  await writeFile(otherUri.fsPath, "echo 'other file'\n");
  try {
    const document = await vscode.workspace.openTextDocument(sourceUri);
    const other = await vscode.workspace.openTextDocument(otherUri);
    await vscode.window.showTextDocument(document);
    await run(document, other, diskText);
  } finally {
    for (const uri of [sourceUri, otherUri]) {
      const document = vscode.workspace.textDocuments.find(
        (entry) => entry.uri.toString() === uri.toString()
      );
      if (document && !document.isClosed) {
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}

describe("local Jenkinsfile replay", () => {
  it("submits real dirty editor text through tree and editor flows without saving or touching drafts", async function () {
    this.timeout(30_000);
    const { LocalJenkinsfileResolver, JenkinsfileMatcher, LocalJenkinsfileReplayWorkflow } =
      await modules();
    await withJenkinsfile(async (document, other, diskText) => {
      const matcher = new JenkinsfileMatcher(["**/Jenkinsfile"], ["file"]);
      const resolver = new LocalJenkinsfileResolver(matcher);
      const environment = {
        environmentId: "local-replay-test",
        scope: "workspace",
        url: "https://jenkins.example/"
      };
      const jobUrl = `${environment.url}job/example/`;
      const dirtyText = "node { echo 'unsaved source' }\n";
      await replaceText(document, dirtyText);
      const drafts = () =>
        vscode.workspace.textDocuments
          .filter((entry) => entry.uri.scheme === "jenkins-replay")
          .map((entry) => ({
            uri: entry.uri.toString(),
            text: entry.getText(),
            dirty: entry.isDirty
          }));
      const previousDrafts = drafts();
      const submissions: Array<{ buildUrl: string; payload: Payload }> = [];
      const refreshed: string[] = [];
      let getJobCalls = 0;
      let pickedSource: vscode.Uri | undefined;
      let cancelled = false;
      const workflow = new LocalJenkinsfileReplayWorkflow(
        {
          getJob: async () => {
            getJobCalls++;
            return { lastCompletedBuild: { number: 11 } };
          },
          getReplayDefinition: async () => {
            await vscode.window.showTextDocument(other);
            return {
              mainScript: "echo 'original'",
              loadedScripts: [{ postField: "loadedScript1", script: "echo 'library'" }]
            };
          },
          runReplay: async (_environment: unknown, buildUrl: string, payload: Payload) => {
            submissions.push({ buildUrl, payload });
            return { queueLocation: `${environment.url}queue/item/7/` };
          }
        },
        resolver,
        {
          pick: async (source: vscode.Uri) => {
            pickedSource = source;
            return cancelled ? undefined : { environment, jobUrl, label: "example" };
          }
        },
        { awaitQueuedBuildStart: async () => undefined }
      );
      const refreshHost = {
        fullEnvironmentRefresh: ({ environmentId }: { environmentId: string }) => {
          refreshed.push(environmentId);
          return { executed: true };
        }
      };
      try {
        await workflow.run(refreshHost, { environment, buildUrl: `${jobUrl}4/`, label: "#4" });
        assert.equal(getJobCalls, 0);
        assert.equal(submissions[0]?.buildUrl, `${jobUrl}4/`);
        assert.equal(submissions[0]?.payload.mainScript, dirtyText);
        assert.deepEqual(submissions[0]?.payload.loadedScripts, [
          { postField: "loadedScript1", script: "echo 'library'" }
        ]);

        await workflow.run(refreshHost, document.uri);
        assert.equal(pickedSource?.toString(), document.uri.toString());
        assert.equal(getJobCalls, 1);
        assert.equal(submissions[1]?.buildUrl, `${jobUrl}11/`);
        assert.equal(submissions[1]?.payload.mainScript, dirtyText);
        await until(() => refreshed.length === 2, "Expected both replay refreshes");

        cancelled = true;
        await workflow.run(refreshHost, document.uri);
        assert.equal(submissions.length, 2);
        assert.equal(document.isDirty, true);
        assert.equal(document.getText(), dirtyText);
        assert.equal(await readFile(document.uri.fsPath, "utf8"), diskText);
        assert.deepEqual(drafts(), previousDrafts);
      } finally {
        matcher.dispose();
      }
    });
  });

  (process.env.JENKINS_REPLAY_LIVE ? it : it.skip)(
    "runs an unsaved script on Jenkins while preserving parameters and loaded scripts",
    async function () {
      this.timeout(60_000);
      const {
        LocalJenkinsfileResolver,
        JenkinsfileMatcher,
        LocalJenkinsfileReplayWorkflow,
        JenkinsClient,
        QueuedBuildWaiter
      } = await modules();
      const url = process.env.JENKINS_REPLAY_URL ?? "http://127.0.0.1:8080/";
      assert.ok(
        ["127.0.0.1", "localhost"].includes(new URL(url).hostname),
        "Live replay integration tests require a local Jenkins fixture"
      );
      const jobUrl = process.env.JENKINS_REPLAY_JOB_URL;
      assert.ok(jobUrl, "JENKINS_REPLAY_JOB_URL is required for the live replay test");
      assert.equal(new URL(jobUrl).origin, new URL(url).origin);
      const client = new JenkinsClient({
        baseUrl: url,
        username: process.env.JENKINS_REPLAY_USER ?? "admin",
        token: process.env.JENKINS_REPLAY_TOKEN ?? "11decafbaddecafbaddecafbaddecafbad"
      });
      const environment = { environmentId: "live-local-replay", scope: "workspace", url };
      await withJenkinsfile(async (document, _other, diskText) => {
        const marker = `local-replay-unsaved-${Date.now()}`;
        const text = `node { echo '${marker}'; echo "parameter=\${params.GREETING}"; writeFile file: 'helper.groovy', text: "echo 'local-placeholder-must-not-run'"; load 'helper.groovy' }\n`;
        await replaceText(document, text);
        const matcher = new JenkinsfileMatcher(["**/Jenkinsfile"], ["file"]);
        let submitted: Payload | undefined;
        let refreshed = false;
        let replayUrl: string | undefined;
        const dataService = {
          getJob: async () => client.getJob(jobUrl),
          getReplayDefinition: async (_environment: unknown, buildUrl: string) => {
            const definition = await client.getReplayDefinition(buildUrl);
            assert.ok(definition.loadedScripts.length > 0, "Fixture must expose loaded scripts");
            return definition;
          },
          runReplay: async (_environment: unknown, buildUrl: string, payload: Payload) => {
            submitted = payload;
            const result = await client.runReplay(buildUrl, payload);
            replayUrl = result.buildLocation;
            return result;
          },
          getQueueItem: async (_environment: unknown, id: number) => {
            const item = await client.getQueueItem(id);
            replayUrl ??= item.executable?.url;
            return item;
          }
        };
        const workflow = new LocalJenkinsfileReplayWorkflow(
          dataService,
          new LocalJenkinsfileResolver(matcher),
          { pick: async () => ({ environment, jobUrl, label: "Live replay" }) },
          new QueuedBuildWaiter(dataService)
        );
        try {
          await workflow.run(
            {
              fullEnvironmentRefresh: () => {
                refreshed = true;
                return { executed: true };
              }
            },
            document.uri
          );
          assert.equal(submitted?.mainScript, text);
          assert.ok(submitted.loadedScripts.length > 0);
          await until(() => refreshed, "Replay never reached refresh");
          await until(async () => {
            if (!replayUrl) {
              // A short-lived queue item can disappear before the waiter observes it.
              // Recover only the build carrying this invocation's unique script marker.
              for (const build of await client.getBuilds(jobUrl, 20)) {
                const output = await client.getConsoleText(build.url);
                if (output.text.includes(marker)) {
                  replayUrl = build.url;
                  break;
                }
              }
            }
            if (!replayUrl) return false;
            const console = await client.getConsoleText(replayUrl);
            if (!console.text.includes(marker) || !console.text.includes("Finished:")) return false;
            const details = await client.getBuildDetails(replayUrl, { statusOnly: true });
            assert.equal(details.result, "SUCCESS", console.text);
            assert.ok(console.text.includes("parameter=retained-parameter"));
            assert.ok(console.text.includes("loaded-script-preserved"));
            assert.ok(!console.text.includes("local-placeholder-must-not-run"));
            return true;
          }, "Replayed build did not execute the local script and retained context");
          assert.ok(replayUrl);
          assert.equal(document.isDirty, true);
          assert.equal(await readFile(document.uri.fsPath, "utf8"), diskText);

          const emptyJobUrl = process.env.JENKINS_REPLAY_EMPTY_JOB_URL;
          if (emptyJobUrl) {
            assert.equal(new URL(emptyJobUrl).origin, new URL(url).origin);
            let replayRequests = 0;
            let definitionRequests = 0;
            const emptyWorkflow = new LocalJenkinsfileReplayWorkflow(
              {
                getJob: async () => client.getJob(emptyJobUrl),
                getReplayDefinition: async () => {
                  definitionRequests++;
                  throw new Error("An empty job cannot have a replay definition");
                },
                runReplay: async () => {
                  replayRequests++;
                  throw new Error("An empty job must never receive a replay POST");
                }
              },
              new LocalJenkinsfileResolver(matcher),
              { pick: async () => ({ environment, jobUrl: emptyJobUrl, label: "Empty Pipeline" }) },
              { awaitQueuedBuildStart: async () => undefined }
            );
            await emptyWorkflow.run(
              { fullEnvironmentRefresh: () => assert.fail("Empty job must not refresh") },
              document.uri
            );
            assert.equal(definitionRequests, 0);
            assert.equal(replayRequests, 0);
          }

          const readerUser = process.env.JENKINS_REPLAY_READER_USER;
          const readerToken = process.env.JENKINS_REPLAY_READER_TOKEN;
          if (readerUser && readerToken) {
            const readerClient = new JenkinsClient({
              baseUrl: url,
              username: readerUser,
              token: readerToken
            });
            await assert.rejects(readerClient.getReplayDefinition(replayUrl), (error: unknown) => {
              const status = (error as { statusCode?: number }).statusCode;
              return status === 403 || status === 404;
            });
            let replayRequests = 0;
            const deniedWorkflow = new LocalJenkinsfileReplayWorkflow(
              {
                getJob: async () => assert.fail("Exact-build replay must not fetch a job"),
                getReplayDefinition: async (_environment: unknown, buildUrl: string) =>
                  readerClient.getReplayDefinition(buildUrl),
                runReplay: async () => {
                  replayRequests++;
                  throw new Error("Denied replay must never receive a POST");
                }
              },
              new LocalJenkinsfileResolver(matcher),
              { pick: async () => assert.fail("Exact-build replay must not pick a job") },
              { awaitQueuedBuildStart: async () => undefined }
            );
            await deniedWorkflow.run(
              { fullEnvironmentRefresh: () => assert.fail("Denied replay must not refresh") },
              { environment, buildUrl: replayUrl, label: "Denied replay" }
            );
            assert.equal(replayRequests, 0);
          }

          assert.equal(document.isDirty, true);
          assert.equal(document.getText(), text);
          assert.equal(await readFile(document.uri.fsPath, "utf8"), diskText);
        } finally {
          matcher.dispose();
        }
      });
    }
  );
});
