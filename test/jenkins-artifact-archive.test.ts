import assert from "node:assert/strict";
import * as http from "node:http";
import type { Readable } from "node:stream";
import { describe, it, vi } from "vitest";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../src/jenkins/errors";
import { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import { buildArtifactArchiveDownloadUrl } from "../src/jenkins/urls";

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/jenkins/`;
}

async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

function createService(baseUrl: string, getClient?: () => Promise<JenkinsClient>) {
  const client = new JenkinsClient({
    baseUrl,
    authConfig: { type: "basic", username: "user", token: "secret" },
    requestTimeoutMs: 10_000
  });
  const provider = {
    getClient: getClient ?? (async () => client)
  } as unknown as JenkinsClientProvider;
  return {
    client,
    service: new JenkinsDataService(provider, {
      buildParameterRequestPreparer: {
        prepareBuildParameters: async () => ({ hasParameters: false })
      }
    }),
    environment: { environmentId: "env-1", scope: "workspace" as const, url: baseUrl }
  };
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as Readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("artifact archive URL", () => {
  it.each([
    "https://jenkins.example/job/demo/42",
    "https://jenkins.example/job/demo/42/",
    "https://jenkins.example/jenkins/job/folder/job/encoded%20name/42/"
  ])("preserves the build path and literal ZIP route for %s", (buildUrl) => {
    assert.equal(
      buildArtifactArchiveDownloadUrl(buildUrl),
      `${buildUrl.replace(/\/$/, "")}/artifact/*zip*/archive.zip`
    );
  });
});

describe("artifact archive API", () => {
  it("streams the authenticated archive through the data-service facade", async () => {
    const archive = Buffer.from([0x50, 0x4b, 3, 4, 0, 0xff]);
    const requests: { path: string | undefined; auth: string | undefined }[] = [];
    const server = http.createServer((request, response) => {
      requests.push({ path: request.url, auth: request.headers.authorization });
      response.writeHead(200, { "content-type": "application/zip" });
      response.end(archive);
    });
    try {
      const baseUrl = await listen(server);
      const { service, environment } = createService(baseUrl);
      const response = await service.getArtifactArchiveStream(
        environment,
        `${baseUrl}job/folder/job/encoded%20name/42/`,
        { maxBytes: 100 }
      );
      assert.deepEqual(await readStream(response.stream), archive);
      assert.equal(response.headers["content-type"], "application/zip");
      assert.deepEqual(requests, [
        {
          path: "/jenkins/job/folder/job/encoded%20name/42/artifact/*zip*/archive.zip",
          auth: `Basic ${Buffer.from("user:secret").toString("base64")}`
        }
      ]);
    } finally {
      await close(server);
    }
  });

  it.each([true, false])("enforces the byte limit with content length %s", async (hasLength) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, hasLength ? { "content-length": "6" } : {});
      response.end("123456");
    });
    try {
      const baseUrl = await listen(server);
      const { service, environment } = createService(baseUrl);
      await assert.rejects(async () => {
        const response = await service.getArtifactArchiveStream(environment, `${baseUrl}job/a/1/`, {
          maxBytes: 3
        });
        await readStream(response.stream);
      }, JenkinsMaxBytesError);
    } finally {
      await close(server);
    }
  });

  it.each(["headers", "stream"])("cancels while awaiting %s", async (stage) => {
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let closed!: () => void;
    const requestClosed = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const server = http.createServer((_request, response) => {
      response.on("close", closed);
      if (stage === "stream") {
        response.writeHead(200);
        response.write("partial archive");
      }
      started();
    });
    try {
      const baseUrl = await listen(server);
      const { service, environment } = createService(baseUrl);
      const controller = new AbortController();
      const pending = assert.rejects(async () => {
        const response = await service.getArtifactArchiveStream(environment, `${baseUrl}job/a/1/`, {
          signal: controller.signal
        });
        await readStream(response.stream);
      });
      await requestStarted;
      controller.abort();
      await pending;
      await requestClosed;
    } finally {
      await close(server);
    }
  });

  it("stops before resolving a client when already canceled", async () => {
    const getClient = vi.fn();
    const { service, environment } = createService("https://jenkins.example/", getClient);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      service.getArtifactArchiveStream(environment, `${environment.url}job/a/1/`, {
        signal: controller.signal
      })
    );
    assert.equal(getClient.mock.calls.length, 0);
  });

  it("does not issue an archive request if canceled while resolving the client", async () => {
    const controller = new AbortController();
    const { client } = createService("https://jenkins.example/");
    const request = vi.spyOn(client, "getArtifactArchiveStream");
    const { service, environment } = createService("https://jenkins.example/", async () => {
      controller.abort();
      return client;
    });
    await assert.rejects(
      service.getArtifactArchiveStream(environment, `${environment.url}job/a/1/`, {
        signal: controller.signal
      })
    );
    assert.equal(request.mock.calls.length, 0);
  });

  it("preserves Jenkins failures for missing artifacts", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(404);
      response.end("No artifacts");
    });
    try {
      const baseUrl = await listen(server);
      const { service, environment } = createService(baseUrl);
      await assert.rejects(
        service.getArtifactArchiveStream(environment, `${baseUrl}job/a/1/`),
        (error: unknown) => error instanceof JenkinsRequestError && error.statusCode === 404
      );
    } finally {
      await close(server);
    }
  });
});
