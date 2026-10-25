import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as https from "node:https";
import type { Duplex } from "node:stream";
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

async function selfSignedJenkins(credentials: { cert: Buffer; key: Buffer }) {
  const sockets = new Set<Duplex>();
  const server = https.createServer(credentials, (request, response) => {
    const url = new URL(request.url ?? "/", "https://localhost");
    if (url.pathname !== "/api/json") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jobs: [{ name: "TLS fixture", color: "blue" }] }));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `https://127.0.0.1:${address.port}/`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

function isCertificateError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /self[- ]signed certificate|unable to verify|certificate.*expired/i.test(error.message)
  );
}

describe("per-environment TLS policy in the extension host", () => {
  it("rejects untrusted TLS by default and applies current stored exceptions without leaking them", async function () {
    this.timeout(20_000);
    const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
    assert.ok(extension);
    const load = (relative: string) =>
      // Load host modules against the real vscode runtime, without Vitest's vscode alias.
      import(vscode.Uri.joinPath(extension.extensionUri, "out-test", "host", relative).fsPath);
    const [{ JenkinsEnvironmentStore }, { JenkinsClientProvider }] = await Promise.all([
      load("storage/JenkinsEnvironmentStore.js"),
      load("jenkins/JenkinsClientProvider.js")
    ]);
    const fixturePath = (file: string) =>
      vscode.Uri.joinPath(extension.extensionUri, "test", "fixtures", "tls", file).fsPath;
    const credentials = {
      cert: await readFile(fixturePath("self-signed-cert.pem")),
      key: await readFile(fixturePath("self-signed-key.pem"))
    };
    const first = await selfSignedJenkins(credentials);
    let second: Awaited<ReturnType<typeof selfSignedJenkins>> | undefined;
    const secrets = new Map<string, string>();
    const store = new JenkinsEnvironmentStore({
      workspaceState: memoryMemento(),
      globalState: memoryMemento(),
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
    const provider = new JenkinsClientProvider(store, { requestTimeoutMs: 2_000 });
    const reference = {
      environmentId: "tls-extension-host",
      scope: "workspace",
      url: first.url,
      allowInsecureTls: false
    };
    const changedPolicies: boolean[] = [];
    const changes = store.onDidChange((change: { tlsPolicyChanged?: boolean }) => {
      if (change.tlsPolicyChanged) changedPolicies.push(true);
    });
    const getJobs = async (environment = reference) =>
      (await provider.getClient(environment)).getRootJobs();
    try {
      second = await selfSignedJenkins(credentials);
      await store.addEnvironment("workspace", { id: reference.environmentId, url: first.url });
      await store.setAuthConfig("workspace", reference.environmentId, { type: "none" });
      await assert.rejects(getJobs(), isCertificateError);
      await assert.rejects(getJobs({ ...reference, allowInsecureTls: true }), isCertificateError);

      await store.updateEnvironment("workspace", reference.environmentId, {
        allowInsecureTls: true
      });
      // An old secure reference must pick up the newly stored exception.
      assert.deepEqual(await getJobs(), [{ name: "TLS fixture", color: "blue" }]);
      await store.addEnvironment("workspace", { id: "other-environment", url: first.url });
      await assert.rejects(
        getJobs({ ...reference, environmentId: "other-environment", allowInsecureTls: true }),
        isCertificateError
      );
      await store.addEnvironment("global", { id: reference.environmentId, url: first.url });
      await assert.rejects(getJobs({ ...reference, scope: "global" }), isCertificateError);

      await store.updateEnvironment("workspace", reference.environmentId, {
        allowInsecureTls: false
      });
      // A stale insecure reference must never restore the old exception.
      await assert.rejects(getJobs({ ...reference, allowInsecureTls: true }), isCertificateError);
      await store.updateEnvironment("workspace", reference.environmentId, {
        allowInsecureTls: true
      });
      assert.equal((await getJobs()).length, 1);

      await store.updateEnvironment("workspace", reference.environmentId, { url: second.url });
      const movedReference = { ...reference, url: second.url, allowInsecureTls: true };
      await assert.rejects(getJobs(movedReference), isCertificateError);
      await assert.rejects(getJobs({ ...reference, allowInsecureTls: true }), isCertificateError);
      await store.updateEnvironment("workspace", reference.environmentId, {
        allowInsecureTls: true
      });
      assert.equal((await getJobs(movedReference)).length, 1);
      // Even after opting into the new origin, the old origin remains verified.
      await assert.rejects(getJobs({ ...reference, allowInsecureTls: true }), isCertificateError);
      assert.equal(changedPolicies.length, 5);
    } finally {
      changes.dispose();
      await Promise.all([first.close(), second?.close()]);
    }
  });
});
