import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { JenkinsBuildConsoleClient } from "../src/jenkins/client/JenkinsBuildConsoleClient";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsStreamResponse } from "../src/jenkins/request";
import type { JenkinsAuthConfig } from "../src/jenkins/types";
import { exactModuleMock, withModuleMocks } from "./helpers/moduleMock";

interface RequestAttempt {
  url: string;
  headers?: Record<string, string>;
}

let streamAttempts: RequestAttempt[] = [];
let streamBody = "";
let streamHeaders: Record<string, string> = {};

const requestMock = {
  requestTextWithHeaders: async () => {
    throw new JenkinsRequestError("Crumbs disabled", 404, "");
  },
  requestStream: async (
    url: string,
    options?: { headers?: Record<string, string> }
  ): Promise<JenkinsStreamResponse> => {
    streamAttempts.push({ url, headers: options?.headers });
    if (streamAttempts.length === 1) {
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

const { JenkinsHttpClient } = withModuleMocks(
  [exactModuleMock("../request", requestMock)],
  () =>
    require("../src/jenkins/client/JenkinsHttpClient") as typeof import(
      "../src/jenkins/client/JenkinsHttpClient"
    )
);

describe("JenkinsHttpClient SSO stream retry", () => {
  it("refreshes stale SSO auth before returning console text head streams", async () => {
    streamAttempts = [];
    streamBody = "console-head-ok";
    streamHeaders = { "content-length": Buffer.byteLength(streamBody).toString() };
    const consoleClient = new JenkinsBuildConsoleClient(
      createSsoHttpClient("https://jenkins.example.com/", "session=stale")
    );

    const result = await consoleClient.getConsoleTextHead(
      "https://jenkins.example.com/job/example/1/",
      100
    );

    assert.equal(result.text, "console-head-ok");
    assert.equal(streamAttempts.length, 2);
    assert.equal(streamAttempts[0].headers?.Cookie, "session=stale");
    assert.equal(streamAttempts[1].headers?.Cookie, "session=fresh");
  });

  it("refreshes stale SSO auth before returning progressive console streams", async () => {
    streamAttempts = [];
    streamBody = "progressive-ok";
    streamHeaders = {
      "content-length": Buffer.byteLength(streamBody).toString(),
      "x-more-data": "false",
      "x-text-size": Buffer.byteLength(streamBody).toString()
    };
    const consoleClient = new JenkinsBuildConsoleClient(
      createSsoHttpClient("https://jenkins.example.com/", "session=stale")
    );

    const result = await consoleClient.getConsoleTextProgressive(
      "https://jenkins.example.com/job/example/1/",
      0,
      100
    );

    assert.equal(result.text, "progressive-ok");
    assert.equal(result.moreData, false);
    assert.equal(streamAttempts.length, 2);
    assert.equal(streamAttempts[0].headers?.Cookie, "session=stale");
    assert.equal(streamAttempts[1].headers?.Cookie, "session=fresh");
  });
});

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
    authConfig,
    refreshAuthConfig: async (currentAuthConfig): Promise<JenkinsAuthConfig> => ({
      type: "sso",
      loginUrl: currentAuthConfig.type === "sso" ? currentAuthConfig.loginUrl : authConfig.loginUrl,
      headers: { Cookie: "session=fresh" }
    })
  });
}
