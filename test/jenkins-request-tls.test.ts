import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import * as http from "node:http";
import * as https from "node:https";
import { text } from "node:stream/consumers";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  requestBufferWithHeaders,
  requestHeaders,
  requestJson,
  requestStream,
  requestText,
  requestVoidWithLocation
} from "../src/jenkins/request";
import { createRequestTarget } from "../src/jenkins/request/transport";

// Public test-only certificate and key. Neither is used outside the loopback test server.
const credentials = {
  key: readFileSync(new URL("fixtures/tls/self-signed-key.pem", import.meta.url)),
  cert: readFileSync(new URL("fixtures/tls/self-signed-cert.pem", import.meta.url))
};

async function listen(server: http.Server | https.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `${server instanceof https.Server ? "https" : "http"}://127.0.0.1:${address.port}`;
}

function close(server: http.Server | https.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location });
  response.end();
}

describe("per-environment HTTPS certificate verification", () => {
  let baseUrl: string;
  let otherUrl: string;
  let httpUrl: string;
  const other = https.createServer(credentials, (_request, response) => response.end("other"));
  const plain = http.createServer((_request, response) => redirect(response, `${baseUrl}/final`));
  const server = https.createServer(credentials, (request, response) => {
    switch (request.url) {
      case "/same-origin":
        redirect(response, "/final");
        break;
      case "/cross-origin":
        redirect(response, `${otherUrl}/final`);
        break;
      case "/downgrade":
        redirect(response, httpUrl);
        break;
      default:
        response.setHeader("content-type", "application/json");
        response.end('{"ok":true}');
    }
  });

  beforeAll(async () => {
    baseUrl = await listen(server);
    otherUrl = await listen(other);
    httpUrl = await listen(plain);
  });

  afterAll(async () => {
    await Promise.all([close(server), close(other), close(plain)]);
  });

  async function read(mode: "standard" | "stream", path: string, allowInsecureTls?: boolean) {
    const options = { allowInsecureTls, timeoutMs: 2000 };
    return mode === "standard"
      ? requestText(`${baseUrl}${path}`, options)
      : text((await requestStream(`${baseUrl}${path}`, options)).stream);
  }

  it.each(["standard", "stream"] as const)(
    "rejects self-signed certificates by default and after opt-in is removed for %s requests",
    async (mode) => {
      for (const value of [undefined, false, "true" as unknown as boolean]) {
        await assert.rejects(read(mode, "/final", value), /self-signed certificate/);
      }
      assert.equal(await read(mode, "/final", true), '{"ok":true}');
      await assert.rejects(read(mode, "/final", false), /self-signed certificate/);
    }
  );

  it.each(["standard", "stream"] as const)(
    "keeps the exception for same-origin redirects but clears it across origins for %s requests",
    async (mode) => {
      assert.equal(await read(mode, "/same-origin", true), '{"ok":true}');
      await assert.rejects(read(mode, "/cross-origin", true), /self-signed certificate/);
      // A redirect through HTTP must not regain the exception when it returns to Jenkins.
      await assert.rejects(read(mode, "/downgrade", true), /self-signed certificate/);
    }
  );

  it("supports JSON, HEAD, buffer and POST requests with the same explicit opt-in", async () => {
    const options = { allowInsecureTls: true, timeoutMs: 2000 };
    assert.deepEqual(await requestJson(`${baseUrl}/final`, options), { ok: true });
    assert.equal(
      (await requestHeaders(`${baseUrl}/final`, options))["content-type"],
      "application/json"
    );
    const buffer = await requestBufferWithHeaders(`${baseUrl}/final`, options);
    assert.equal(Buffer.from(buffer.data).toString(), '{"ok":true}');
    await requestVoidWithLocation(`${baseUrl}/final`, { ...options, method: "POST", body: "test" });
  });

  it("never supplies TLS options to HTTP and explicitly verifies HTTPS by default", () => {
    assert.deepEqual(createRequestTarget("http://localhost", undefined, true).tlsOptions, {});
    assert.deepEqual(createRequestTarget("https://localhost").tlsOptions, {
      rejectUnauthorized: true
    });
    assert.deepEqual(createRequestTarget("https://localhost", undefined, true).tlsOptions, {
      rejectUnauthorized: false
    });
  });
});
