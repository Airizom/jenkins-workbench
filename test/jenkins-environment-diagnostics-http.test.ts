import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { JenkinsEnvironmentDiagnosticsApi } from "../src/jenkins/client/JenkinsEnvironmentDiagnosticsApi";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../src/jenkins/errors";
import { JenkinsClient } from "../src/jenkins/JenkinsClient";

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;
async function listen(server: http.Server | https.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `${server instanceof https.Server ? "https" : "http"}://127.0.0.1:${address.port}`;
}
async function close(server: http.Server | https.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

const tlsCredentials = {
  key: readFileSync(new URL("fixtures/tls/self-signed-key.pem", import.meta.url)),
  cert: readFileSync(new URL("fixtures/tls/self-signed-cert.pem", import.meta.url))
};

describe("environment diagnostic HTTP probes", () => {
  let baseUrl: string;
  let otherUrl: string;
  let tlsUrl: string;
  let handler: Handler;
  let otherHandler: Handler;
  const server = http.createServer((request, response) => handler(request, response));
  const other = http.createServer((request, response) => otherHandler(request, response));
  const tls = https.createServer(tlsCredentials, (_request, response) => response.end("{}"));

  beforeAll(async () => {
    [baseUrl, otherUrl, tlsUrl] = await Promise.all([listen(server), listen(other), listen(tls)]);
  });
  afterAll(async () => {
    await Promise.all([close(server), close(other), close(tls)]);
  });

  it("uses GET, the Jenkins context path, minimal queries, and the saved authentication", async () => {
    const seen: string[] = [];
    handler = (request, response) => {
      assert.equal(request.method, "GET");
      assert.equal(
        request.headers.authorization,
        `Basic ${Buffer.from("developer:secret").toString("base64")}`
      );
      const url = new URL(request.url ?? "", baseUrl);
      seen.push(url.pathname);
      assert.ok(url.pathname.startsWith("/jenkins/"));
      if (url.pathname.endsWith("/api/json")) {
        assert.ok(url.searchParams.get("tree"));
      }
      response.setHeader("x-jenkins", "2.479.1");
      response.end("{}");
    };
    const api = new JenkinsEnvironmentDiagnosticsApi({
      baseUrl: `${baseUrl}/jenkins/`,
      authConfig: { type: "basic", username: "developer", token: "secret" }
    });
    const result = await api.probe("api", new AbortController().signal);
    assert.equal(result.statusCode, 200);
    assert.equal(result.jenkinsVersion, "2.479.1");
    assert.deepEqual(seen, ["/jenkins/api/json"]);
  });

  it("preserves non-success status for evidence without throwing away connectivity", async () => {
    handler = (_request, response) => {
      response.writeHead(403, { "x-jenkins": "2.479.1" });
      response.end("Private response stays host-only");
    };
    const api = new JenkinsEnvironmentDiagnosticsApi({ baseUrl });
    const result = await api.probe("authentication", new AbortController().signal);
    assert.equal(result.statusCode, 403);
    assert.equal(result.jenkinsVersion, "2.479.1");
  });

  it("rejects login redirects without calling automatic SSO refresh", async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: "/jenkins/login" });
      response.end();
    };
    const refresh = vi.fn(async () => ({
      type: "sso" as const,
      loginUrl: `${baseUrl}/jenkins/login`
    }));
    const client = new JenkinsClient({
      baseUrl: `${baseUrl}/jenkins/`,
      authConfig: {
        type: "sso",
        loginUrl: `${baseUrl}/jenkins/login`,
        headers: { Cookie: "session=expired" }
      },
      refreshAuthConfig: refresh
    });
    await assert.rejects(
      client.probeEnvironment("authentication", new AbortController().signal),
      (error) => error instanceof JenkinsRequestError && error.statusCode === 302
    );
    assert.equal(refresh.mock.calls.length, 0);
  });

  it("keeps credentials on same-origin redirects and removes them across origins", async () => {
    const seen: Array<string | undefined> = [];
    handler = (request, response) => {
      seen.push(request.headers.authorization);
      if (request.url?.startsWith("/api/json")) {
        response.writeHead(302, { location: "/same" });
      } else {
        response.writeHead(302, { location: `${otherUrl}/final` });
      }
      response.end();
    };
    otherHandler = (request, response) => {
      seen.push(request.headers.authorization);
      assert.equal(request.headers["x-private"], undefined);
      response.end("{}");
    };
    const api = new JenkinsEnvironmentDiagnosticsApi({
      baseUrl,
      authConfig: {
        type: "headers",
        headers: { Authorization: "Bearer private", "X-Private": "private" }
      }
    });
    await api.probe("api", new AbortController().signal);
    assert.deepEqual(seen, ["Bearer private", "Bearer private", undefined]);
  });

  it("honors redirect limits", async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: "/loop" });
      response.end();
    };
    const api = new JenkinsEnvironmentDiagnosticsApi({ baseUrl });
    await assert.rejects(api.probe("api", new AbortController().signal), /Too many redirects/);
  });

  it("bounds both declared and streamed response bodies", async () => {
    const oversized = "x".repeat(256 * 1024 + 1);
    for (const declared of [true, false]) {
      handler = (_request, response) => {
        if (declared) response.setHeader("content-length", oversized.length);
        response.write(oversized);
        response.end();
      };
      const api = new JenkinsEnvironmentDiagnosticsApi({ baseUrl });
      await assert.rejects(
        api.probe("api", new AbortController().signal),
        (error) => error instanceof JenkinsMaxBytesError && error.statusCode === 200
      );
    }
  });

  it("does not accept an interrupted response as complete", async () => {
    handler = (_request, response) => {
      response.writeHead(200, { "content-length": 100 });
      response.write("{}");
      setImmediate(() => response.destroy());
    };
    const api = new JenkinsEnvironmentDiagnosticsApi({ baseUrl });
    await assert.rejects(api.probe("api", new AbortController().signal));
  });

  it("honors timeout settings and preserves a timeout code", async () => {
    handler = () => undefined;
    const api = new JenkinsEnvironmentDiagnosticsApi({ baseUrl, requestTimeoutMs: 20 });
    await assert.rejects(
      api.probe("api", new AbortController().signal),
      (error) => error instanceof JenkinsRequestError && error.code === "ETIMEDOUT"
    );
  });

  it("aborts a running probe promptly", async () => {
    let started: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    handler = () => started?.();
    const api = new JenkinsEnvironmentDiagnosticsApi({ baseUrl });
    const controller = new AbortController();
    const pending = api.probe("api", controller.signal);
    await requestStarted;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  });

  it("uses the stored TLS exception only for the original origin", async () => {
    const verified = new JenkinsEnvironmentDiagnosticsApi({ baseUrl: tlsUrl });
    await assert.rejects(verified.probe("api", new AbortController().signal));
    const insecure = new JenkinsEnvironmentDiagnosticsApi({
      baseUrl: tlsUrl,
      allowInsecureTls: true
    });
    assert.equal((await insecure.probe("api", new AbortController().signal)).statusCode, 200);
    handler = (_request, response) => {
      response.writeHead(302, { location: tlsUrl });
      response.end();
    };
    const redirecting = new JenkinsEnvironmentDiagnosticsApi({ baseUrl, allowInsecureTls: true });
    await assert.rejects(redirecting.probe("api", new AbortController().signal));
  });

  it("omits unsafe Jenkins version header values", async () => {
    handler = (_request, response) => {
      response.setHeader("x-jenkins", "private unsafe response");
      response.end("{}");
    };
    const api = new JenkinsEnvironmentDiagnosticsApi({ baseUrl });
    assert.equal((await api.probe("api", new AbortController().signal)).jenkinsVersion, undefined);
  });
});
