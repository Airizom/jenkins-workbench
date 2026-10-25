import assert from "node:assert/strict";
import * as http from "node:http";
import { describe, it } from "vitest";
import { JenkinsHttpClient } from "../src/jenkins/client/JenkinsHttpClient";
import { JenkinsNodeLogClient } from "../src/jenkins/client/JenkinsNodeLogClient";

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/`;
}

async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

describe("agent log HTTP cancellation", () => {
  it.each(["headers", "stream"])("aborts an active %s request", async (stage) => {
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let closed!: () => void;
    const requestClosed = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const server = http.createServer((request, response) => {
      if (stage === "stream" && request.method === "HEAD") {
        response.writeHead(200, { "x-text-size": "100" });
        response.end();
        return;
      }
      response.on("close", closed);
      if (stage === "stream") {
        response.writeHead(200, { "x-text-size": "100" });
        response.write("partial log");
      }
      started();
    });
    try {
      const baseUrl = await listen(server);
      const log = new JenkinsNodeLogClient(
        new JenkinsHttpClient({ baseUrl, requestTimeoutMs: 10_000 })
      );
      const controller = new AbortController();
      const pending = assert.rejects(
        log.getLog(`${baseUrl}computer/agent/`, { signal: controller.signal })
      );
      await requestStarted;
      controller.abort();
      await pending;
      await requestClosed;
    } finally {
      await close(server);
    }
  });
});
