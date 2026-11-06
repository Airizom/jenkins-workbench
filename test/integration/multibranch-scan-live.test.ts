/// <reference types="node" />
/// <reference types="mocha" />
import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

async function until(check: () => Promise<boolean> | boolean, message: string, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.fail(message);
}

async function createGitFixture() {
  const directory = await mkdtemp(join(tmpdir(), "jenkins-scan-live-"));
  try {
    await execFileAsync("git", ["init", "--initial-branch=main", directory]);
    await writeFile(
      join(directory, "Jenkinsfile"),
      "pipeline { agent none; stages { stage('Fixture') { steps { echo 'scan fixture' } } } }\n"
    );
    await execFileAsync("git", ["-C", directory, "add", "Jenkinsfile"]);
    await execFileAsync("git", [
      "-C",
      directory,
      "-c",
      "user.name=Workbench Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Scan fixture"
    ]);
    await execFileAsync("git", ["-C", directory, "update-server-info"]);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const root = join(directory, ".git");
  const control = { fail: false, delayMillis: 2500 };
  const server = createServer((request, response) => {
    void (async () => {
      if (control.fail) {
        response.writeHead(401, { "WWW-Authenticate": 'Basic realm="scan-fixture"' });
        response.end("Fixture credentials refused");
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://fixture").pathname);
      if (pathname.endsWith("/info/refs")) {
        await new Promise((done) => setTimeout(done, control.delayMillis));
      }
      const path = resolve(root, `.${pathname.replace(/^\/repository/, "")}`);
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) {
        response.writeHead(404);
        response.end();
        return;
      }
      const content = await readFile(path);
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": content.byteLength,
        "Cache-Control": "no-cache"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", done);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    control,
    remote: `http://${process.env.JENKINS_SCAN_GIT_HOST ?? "host.docker.internal"}:${address.port}/repository`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    }
  };
}

/** Creates and deletes one isolated multibranch job on the loopback development fixture. */
describe("local Jenkins multibranch scan", () => {
  (process.env.JENKINS_SCAN_LIVE ? it : it.skip)(
    "tracks queued/running/results, streams an editor, refreshes branches, and attaches externally",
    async function () {
      this.timeout(150_000);
      const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
      assert.ok(extension);
      const load = (path: string) =>
        import(vscode.Uri.joinPath(extension.extensionUri, "out-test", "host", path).fsPath);
      const [
        { JenkinsClient },
        { JenkinsDataService },
        { MultibranchScanStateStore },
        { MultibranchScanService },
        { MultibranchScanLogViewer },
        { ArtifactPreviewProvider }
      ] = await Promise.all([
        load("jenkins/JenkinsClient.js"),
        load("jenkins/JenkinsDataService.js"),
        load("services/multibranchScan/MultibranchScanState.js"),
        load("services/multibranchScan/MultibranchScanService.js"),
        load("services/multibranchScan/MultibranchScanLogViewer.js"),
        load("ui/ArtifactPreviewProvider.js")
      ]);
      const url = process.env.JENKINS_SCAN_URL ?? "http://127.0.0.1:8080/";
      assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
      const username = process.env.JENKINS_SCAN_USER ?? "admin";
      const token = process.env.JENKINS_SCAN_TOKEN ?? "11decafbaddecafbaddecafbaddecafbad";
      const runScript = async (script: string) => {
        const response = await fetch(new URL("scriptText", url), {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({ script }),
          signal: AbortSignal.timeout(20_000)
        });
        assert.ok(response.ok, `Fixture script failed: HTTP ${response.status}`);
        return response.text();
      };
      const client = new JenkinsClient({ baseUrl: url, username, token, requestTimeoutMs: 15_000 });
      const data = new JenkinsDataService(
        { getClient: async () => client, getAuthSignature: async () => "scan-live-fixture" },
        {
          cacheTtlMs: 60_000,
          buildParameterRequestPreparer: {
            prepareBuildParameters: async () => ({ hasParameters: false })
          }
        }
      );
      const name = `workbench-scan-validation-${Date.now()}`;
      const target = {
        environment: { environmentId: name, scope: "workspace", url, name: "Scan fixture" },
        folderUrl: new URL(`job/${name}/`, url).href,
        label: name
      };
      const git = await createGitFixture();
      const state = new MultibranchScanStateStore();
      const tracker = new MultibranchScanService(data, state, { pollIntervalMs: 250 });
      const previews = new ArtifactPreviewProvider();
      // Avoid colliding with the already activated extension's preview filesystem.
      const scheme = "jenkins-scan-live";
      const originalRegister = previews.registerArtifact.bind(previews);
      previews.registerArtifact = (bytes: Uint8Array, fileName: string) =>
        originalRegister(bytes, fileName).with({ scheme });
      const filesystem = vscode.workspace.registerFileSystemProvider(scheme, previews, {
        isReadonly: true
      });
      const viewer = new MultibranchScanLogViewer(tracker, state, previews);
      const phases = new Set<string>();
      const changed = state.onDidChange((value: { phase: string }) => phases.add(value.phase));
      let completions = 0;
      const completed = tracker.onDidComplete(() => {
        completions++;
        data.clearCacheForEnvironment(target.environment.environmentId);
      });
      let submissions = 0;
      const originalScan = data.scanMultibranch.bind(data);
      data.scanMultibranch = (...args: unknown[]) => {
        submissions++;
        return originalScan(...args);
      };
      try {
        const setup = await readFile(
          vscode.Uri.joinPath(extension.extensionUri, "dev", "jenkins", "scan-validation.groovy")
            .fsPath,
          "utf8"
        );
        const result = await runScript(
          `binding.setVariable('fixtureName', ${JSON.stringify(name)})\nbinding.setVariable('fixtureRemote', ${JSON.stringify(git.remote)})\n${setup}`
        );
        assert.ok(result.includes(`SCAN_FIXTURE_READY:${name}`), result);
        assert.equal((await data.getJobsForFolder(target.environment, target.folderUrl)).length, 0);
        await runScript(
          `jenkins.model.Jenkins.get().getItem(${JSON.stringify(name)}).scheduleBuild2(5); println('QUEUED')`
        );
        await tracker.request(target);
        assert.equal(state.get(target).phase, "queued");
        assert.equal(
          submissions,
          0,
          "An externally queued scan must be followed without another POST"
        );
        await viewer.open(target);
        const document = vscode.window.activeTextEditor?.document;
        assert.equal(document?.uri.scheme, scheme);
        assert.ok(document);
        await until(() => state.get(target)?.phase === "running", "Queued scan never ran");
        await until(
          () => document.getText().includes("Scan running"),
          "Editor did not receive running state"
        );
        await Promise.all([tracker.request(target), tracker.request(target)]);
        assert.equal(submissions, 0, "Repeated requests must reuse active indexing");
        await until(
          () => state.get(target)?.phase === "completed",
          "First indexing never completed"
        );
        assert.equal(state.get(target).outcome, "success", state.get(target).log?.text);
        await until(
          () => document.getText().includes("Finished: SUCCESS"),
          "Final log did not reach editor"
        );
        assert.equal(completions, 1);
        assert.ok(
          (await data.getJobsForFolder(target.environment, target.folderUrl)).some(
            (job: { name: string }) => job.name === "main"
          ),
          state.get(target).log?.text
        );
        const observed = await data.getMultibranchScanLog(target.environment, target.folderUrl);
        assert.equal(observed.source, "progressive");
        assert.equal(observed.moreData, false, "Jenkins omits X-More-Data when complete");
        assert.ok(observed.textSize > 0);

        console.log(
          "[scan-live] queued/running/success, editor, deduplication, and branch refresh passed"
        );
        await tracker.request(target);
        assert.equal(submissions, 1);
        await until(() => state.get(target)?.phase === "running", "Second scan never ran");
        const tabs = vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter(
            (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === scheme
          );
        await vscode.window.tabGroups.close(tabs);
        await until(
          () => state.get(target)?.phase === "completed",
          "Closing the editor stopped tracking"
        );
        assert.equal(state.get(target).outcome, "success");
        assert.equal(completions, 2);

        git.control.fail = true;
        await tracker.request(target);
        await until(
          () => state.get(target)?.phase === "completed",
          "Credential failure never completed"
        );
        assert.equal(state.get(target).outcome, "failure", state.get(target).log?.text);
        await viewer.open(target);
        const failedDocument = vscode.window.activeTextEditor?.document;
        assert.ok(failedDocument);
        assert.match(failedDocument.getText(), /Finished: FAILURE/);
        assert.equal(completions, 3);

        git.control.fail = false;
        await client.scanMultibranch(target.folderUrl);
        await until(
          async () =>
            (await data.getMultibranchScanLog(target.environment, target.folderUrl)).moreData ===
            true,
          "External scan never started"
        );
        await viewer.open(target);
        await until(
          () => state.get(target)?.phase === "running",
          "Opening logs did not attach externally"
        );
        await until(
          () => state.get(target)?.phase === "completed",
          "External scan never completed"
        );
        assert.equal(state.get(target).outcome, "success");
        assert.equal(completions, 4);
        assert.deepEqual([...phases].sort(), ["completed", "queued", "requested", "running"]);
        console.log(
          "[scan-live] close-before-completion, credential failure, and external attachment passed"
        );
      } finally {
        const tabs = vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter(
            (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === scheme
          );
        await vscode.window.tabGroups.close(tabs);
        viewer.dispose();
        tracker.dispose();
        changed.dispose();
        completed.dispose();
        state.dispose();
        filesystem.dispose();
        previews.dispose();
        try {
          const cleanup = await runScript(
            `def p = jenkins.model.Jenkins.get().getItem(${JSON.stringify(name)}); if (p != null) { p.delete() }; println('SCAN_FIXTURE_REMOVED')`
          );
          assert.ok(cleanup.includes("SCAN_FIXTURE_REMOVED"), cleanup);
        } finally {
          await git.close();
        }
      }
    }
  );
});
