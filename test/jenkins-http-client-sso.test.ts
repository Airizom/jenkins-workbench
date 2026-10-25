import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it, vi } from "vitest";
import { JenkinsBuildConsoleClient } from "../src/jenkins/client/JenkinsBuildConsoleClient";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsStreamResponse } from "../src/jenkins/request";
import type { JenkinsAuthConfig } from "../src/jenkins/types";

interface RequestAttempt {
  url: string;
  headers?: Record<string, string>;
  allowInsecureTls?: boolean;
}

let streamAttempts: RequestAttempt[] = [];
let streamBody = "";
let streamHeaders: Record<string, string> = {};

let jsonAttempts = 0;
const requestMock = {
  requestJson: async (
    _url: string,
    options?: { headers?: Record<string, string>; beforeRequest?: () => void }
  ) => {
    options?.beforeRequest?.();
    jsonAttempts++;
    if (options?.headers?.Cookie === "session=stale") {
      throw new JenkinsRequestError("Expired session", 403, "", { "www-authenticate": "LocalSSO" });
    }
    return { ok: true };
  },
  requestTextWithHeaders: async () => {
    throw new JenkinsRequestError("Crumbs disabled", 404, "");
  },
  requestStream: async (
    url: string,
    options?: { headers?: Record<string, string>; allowInsecureTls?: boolean }
  ): Promise<JenkinsStreamResponse> => {
    streamAttempts.push({
      url,
      headers: options?.headers,
      allowInsecureTls: options?.allowInsecureTls
    });
    if (options?.headers?.Cookie === "session=stale") {
      throw new JenkinsRequestError(
        "Jenkins API request failed (403 Forbidden)",
        403,
        "Local SSO session required",
        { "www-authenticate": "LocalSSO" }
      );
    }

    const stream = new PassThrough();
    queueMicrotask(() => stream.end(streamBody));
    return {
      stream,
      headers: streamHeaders,
      abort: () => stream.destroy()
    };
  }
};

vi.doMock("../src/jenkins/request", () => requestMock);
const { JenkinsHttpClient } = await import("../src/jenkins/client/JenkinsHttpClient");

describe("JenkinsHttpClient SSO stream retry", () => {
  it("refreshes stale SSO auth before returning console text head streams", async () => {
    const result = await runSsoStreamRetry("console-head-ok", (consoleClient) =>
      consoleClient.getConsoleTextHead("https://jenkins.example.com/job/example/1/", 100)
    );

    assert.equal(result.text, "console-head-ok");
  });

  it("refreshes stale SSO auth before returning progressive console streams", async () => {
    const result = await runSsoStreamRetry(
      "progressive-ok",
      (consoleClient) =>
        consoleClient.getConsoleTextProgressive(
          "https://jenkins.example.com/job/example/1/",
          0,
          100
        ),
      { "x-more-data": "false", "x-text-size": Buffer.byteLength("progressive-ok").toString() }
    );

    assert.equal(result.text, "progressive-ok");
    assert.equal(result.moreData, false);
  });

  it("invokes the JSON retry budget hook before the second HTTP attempt", async () => {
    jsonAttempts = 0;
    const client = createSsoHttpClient("https://jenkins.example.com/", "session=stale");
    const beforeRequest = vi.fn();
    assert.deepEqual(
      await client.requestJson("https://jenkins.example.com/api/json", { beforeRequest }),
      { ok: true }
    );
    assert.equal(beforeRequest.mock.calls.length, 2);
    assert.equal(jsonAttempts, 2);
  });

  it("does not send a retry if the JSON request budget hook refuses it", async () => {
    jsonAttempts = 0;
    const client = createSsoHttpClient("https://jenkins.example.com/", "session=stale");
    let attempts = 0;
    await assert.rejects(
      client.requestJson("https://jenkins.example.com/api/json", {
        beforeRequest: () => {
          if (++attempts > 1) {
            throw new Error("budget exhausted");
          }
        }
      }),
      /budget exhausted/
    );
    assert.equal(jsonAttempts, 1);
  });

  it("coalesces concurrent SSO refreshes and retries with the same credentials", async () => {
    streamAttempts = [];
    streamBody = "ok";
    streamHeaders = {};
    let resolveRefresh: ((authConfig: JenkinsAuthConfig) => void) | undefined;
    const refreshAuthConfig = vi.fn(
      () =>
        new Promise<JenkinsAuthConfig>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const baseUrl = "https://jenkins.example.com/";
    const client = new JenkinsHttpClient({
      baseUrl,
      authConfig: {
        type: "sso",
        loginUrl: new URL("__sso/login", baseUrl).toString(),
        headers: { Cookie: "session=stale" }
      },
      refreshAuthConfig
    });

    const requests = [
      client.requestStream(`${baseUrl}first`),
      client.requestStream(`${baseUrl}second`)
    ];
    await vi.waitFor(() => assert.equal(refreshAuthConfig.mock.calls.length, 1));
    resolveRefresh?.({
      type: "sso",
      loginUrl: new URL("__sso/login", baseUrl).toString(),
      headers: { Cookie: "session=fresh" }
    });
    await Promise.all(requests);

    assert.equal(refreshAuthConfig.mock.calls.length, 1);
    assert.deepEqual(
      streamAttempts.map((attempt) => attempt.headers?.Cookie),
      ["session=stale", "session=stale", "session=fresh", "session=fresh"]
    );
  });
});

async function runSsoStreamRetry<T>(
  body: string,
  readStream: (consoleClient: JenkinsBuildConsoleClient) => Promise<T>,
  headers: Record<string, string> = {}
): Promise<T> {
  streamAttempts = [];
  streamBody = body;
  streamHeaders = {
    "content-length": Buffer.byteLength(streamBody).toString(),
    ...headers
  };
  const consoleClient = new JenkinsBuildConsoleClient(
    createSsoHttpClient("https://jenkins.example.com/", "session=stale")
  );

  const result = await readStream(consoleClient);
  assert.equal(streamAttempts.length, 2);
  assert.equal(streamAttempts[0].headers?.Cookie, "session=stale");
  assert.equal(streamAttempts[1].headers?.Cookie, "session=fresh");
  assert.ok(streamAttempts.every((attempt) => attempt.allowInsecureTls === true));
  return result;
}

function createSsoHttpClient(
  baseUrl: string,
  cookie: string
): InstanceType<typeof JenkinsHttpClient> {
  const authConfig: JenkinsAuthConfig = {
    type: "sso",
    loginUrl: new URL("__sso/login", baseUrl).toString(),
    headers: { Cookie: cookie }
  };
  return new JenkinsHttpClient({
    baseUrl,
    allowInsecureTls: true,
    authConfig,
    refreshAuthConfig: async (currentAuthConfig): Promise<JenkinsAuthConfig> => ({
      type: "sso",
      loginUrl: currentAuthConfig.type === "sso" ? currentAuthConfig.loginUrl : authConfig.loginUrl,
      headers: { Cookie: "session=fresh" }
    })
  });
}
