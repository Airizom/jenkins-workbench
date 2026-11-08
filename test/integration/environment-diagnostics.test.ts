import * as assert from "node:assert/strict";
import * as vscode from "vscode";

function memento(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    keys: () => [...values.keys()],
    get: <T>(key: string, fallback?: T) => (values.get(key) as T | undefined) ?? fallback,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    }
  } as vscode.Memento;
}

async function diagnosticsFixture(url: string) {
  const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
  assert.ok(extension);
  const load = (relative: string) =>
    import(vscode.Uri.joinPath(extension.extensionUri, "out-test", "host", relative).fsPath);
  const [
    { JenkinsEnvironmentStore },
    { JenkinsClientProvider },
    { JenkinsDataService },
    { EnvironmentDiagnosticsService },
    { EnvironmentDiagnosticsPanelLauncher },
    { BuildParameterRequestPreparerService }
  ] = await Promise.all([
    load("storage/JenkinsEnvironmentStore.js"),
    load("jenkins/JenkinsClientProvider.js"),
    load("jenkins/JenkinsDataService.js"),
    load("environmentDiagnostics/EnvironmentDiagnosticsService.js"),
    load("panels/EnvironmentDiagnosticsPanel.js"),
    load("services/BuildParameterRequestPreparerService.js")
  ]);
  const secrets = new Map<string, string>();
  const store = new JenkinsEnvironmentStore({
    workspaceState: memento(),
    globalState: memento(),
    secrets: {
      get: async (key: string) => secrets.get(key),
      store: async (key: string, value: string) => {
        secrets.set(key, value);
      },
      delete: async (key: string) => {
        secrets.delete(key);
      }
    }
  });
  const environment = { environmentId: "diagnostics-integration", scope: "workspace", url };
  await store.addEnvironment(environment.scope, {
    id: environment.environmentId,
    name: "Diagnostics integration",
    url
  });
  const provider = new JenkinsClientProvider(store, { requestTimeoutMs: 5000 });
  const data = new JenkinsDataService(provider, {
    buildParameterRequestPreparer: new BuildParameterRequestPreparerService()
  });
  return {
    extension,
    store,
    environment,
    service: new EnvironmentDiagnosticsService(data, store),
    EnvironmentDiagnosticsPanelLauncher
  };
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(message);
}

describe("Environment Diagnostics", () => {
  it("mounts the compiled webview and receives its ready message", async function () {
    this.timeout(15_000);
    const fixture = await diagnosticsFixture("https://jenkins.example/");
    const launcher = new fixture.EnvironmentDiagnosticsPanelLauncher({
      extensionUri: fixture.extension.extensionUri,
      store: fixture.store,
      service: {
        run: async (_environment: unknown, runId: number) => ({
          runId,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          checks: [
            {
              id: "connectivity",
              label: "Connectivity and TLS",
              status: "passed",
              code: "reachable",
              summary: "The server is reachable.",
              detail: "Compiled webview integration fixture.",
              actions: []
            }
          ]
        })
      },
      recover: async () => false
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const showing = launcher.show(fixture.environment);
      const session = Reflect.get(launcher, "panels").get("workspace:diagnostics-integration");
      assert.ok(session);
      const ready = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Diagnostics webview did not mount")), 10_000);
        session.panel.webview.onDidReceiveMessage((message: { type?: string }) => {
          if (message?.type === "environmentDiagnosticsReady") resolve();
        });
      });
      await Promise.all([showing, ready]);
      assert.match(session.panel.webview.html, /environmentDiagnostics\/index\./);
      assert.equal(Reflect.get(session, "model").state, "completed");
    } finally {
      clearTimeout(timer);
      launcher.dispose();
    }
  });

  (process.env.JENKINS_PANELS_LIVE ? it : it.skip)(
    "checks real Jenkins and retests the open panel after credential recovery",
    async function () {
      this.timeout(45_000);
      const url = process.env.JENKINS_PANELS_URL ?? "http://127.0.0.1:8080/";
      assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
      const fixture = await diagnosticsFixture(url);
      const auth = {
        type: "basic",
        username: process.env.JENKINS_PANELS_USER ?? "admin",
        token: process.env.JENKINS_PANELS_TOKEN ?? "11decafbaddecafbaddecafbaddecafbad"
      };
      await fixture.store.setAuthConfig("workspace", fixture.environment.environmentId, auth);
      const launcher = new fixture.EnvironmentDiagnosticsPanelLauncher({
        extensionUri: fixture.extension.extensionUri,
        store: fixture.store,
        service: fixture.service,
        recover: async () => false
      });
      try {
        await launcher.show(fixture.environment);
        const session = Reflect.get(launcher, "panels").get("workspace:diagnostics-integration");
        const model = () => Reflect.get(session, "model");
        assert.equal(model().state, "completed");
        assert.equal(model().report.checks.length, 7);
        for (const id of [
          "connectivity",
          "authentication",
          "api",
          "queue",
          "nodes",
          "csrf",
          "pipeline"
        ]) {
          assert.equal(
            model().report.checks.find((check: { id: string }) => check.id === id)?.status,
            "passed",
            `${id} must be accessible on the local fixture`
          );
        }
        assert.ok(model().report.jenkinsVersion);
        assert.ok(!JSON.stringify(model()).includes(auth.token));

        await fixture.store.setAuthConfig("workspace", fixture.environment.environmentId, {
          type: "none"
        });
        await waitFor(
          () =>
            model().state === "completed" &&
            model().report.checks.some(
              (check: { id: string; status: string; code: string }) =>
                check.id === "authentication" &&
                check.status === "passed" &&
                check.code === "anonymous"
            ),
          "Jenkins anonymous identity was not recognized"
        );
        assert.equal(model().report.checks[0].status, "passed");

        await fixture.store.setAuthConfig("workspace", fixture.environment.environmentId, {
          ...auth,
          token: "invalid-diagnostics-fixture-token"
        });
        await waitFor(
          () =>
            model().state === "completed" &&
            model().report.checks.some(
              (check: { id: string; status: string }) =>
                check.id === "authentication" && check.status === "failed"
            ),
          "Changed credentials did not automatically retest"
        );
        assert.equal(model().report.checks[0].status, "passed", "HTTP 401 proves connectivity");

        await fixture.store.setAuthConfig("workspace", fixture.environment.environmentId, auth);
        await waitFor(
          () =>
            model().state === "completed" &&
            model().report.checks.some(
              (check: { id: string; status: string }) =>
                check.id === "authentication" && check.status === "passed"
            ),
          "Recovered credentials did not automatically retest"
        );
        await fixture.store.removeEnvironment("workspace", fixture.environment.environmentId);
        await waitFor(() => model().state === "removed", "Removed environment stayed active");
      } finally {
        launcher.dispose();
      }
    }
  );
});
