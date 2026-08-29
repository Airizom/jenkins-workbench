import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it, vi } from "vitest";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsSimpleRequestOptions } from "../src/jenkins/request";

const BASE_URL = "https://jenkins.example.com/";

interface TextPostAttempt {
  url: string;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

let crumbFetches = 0;
let postAttempts: TextPostAttempt[] = [];
let postBehavior: (attempt: TextPostAttempt) => Promise<string> = async () => "";
const bufferRequest = vi.fn(async (_url: string, _options?: JenkinsSimpleRequestOptions) => ({
  data: new Uint8Array(),
  headers: {}
}));
const streamRequest = vi.fn(async (_url: string, _options?: JenkinsSimpleRequestOptions) => ({
  stream: new PassThrough(),
  headers: {},
  abort: () => undefined
}));

const requestMock = {
  requestBufferWithHeaders: bufferRequest,
  requestStream: streamRequest,
  requestTextWithHeaders: async () => {
    crumbFetches += 1;
    return {
      text: JSON.stringify({
        crumbRequestField: "Jenkins-Crumb",
        crumb: `crumb-${crumbFetches}`
      }),
      headers: {}
    };
  },
  requestText: async (
    url: string,
    options?: { body?: string | Uint8Array; headers?: Record<string, string> }
  ): Promise<string> => {
    const attempt = { url, body: options?.body, headers: options?.headers };
    postAttempts.push(attempt);
    return postBehavior(attempt);
  }
};

vi.doMock("../src/jenkins/request", () => requestMock);
const { JenkinsHttpClient } = await import("../src/jenkins/client/JenkinsHttpClient");

describe("JenkinsHttpClient crumb retry", () => {
  it("does not acquire crumbs for authenticated buffer and stream reads", async () => {
    resetHarness();
    const client = new JenkinsHttpClient({
      baseUrl: BASE_URL,
      authConfig: {
        type: "headers",
        headers: { "X-Auth-Token": "secret" }
      }
    });

    await client.requestBufferWithHeaders(`${BASE_URL}artifact/file.zip`, { maxBytes: 100 });
    await client.requestStream(`${BASE_URL}consoleText`, { maxBytes: 200 });

    assert.equal(crumbFetches, 0);
    assert.deepEqual(bufferRequest.mock.calls[0]?.[1], {
      authHeader: undefined,
      headers: { "X-Auth-Token": "secret" },
      timeoutMs: undefined,
      maxBytes: 100
    });
    assert.deepEqual(streamRequest.mock.calls[0]?.[1], {
      authHeader: undefined,
      headers: { "X-Auth-Token": "secret" },
      timeoutMs: undefined,
      maxBytes: 200
    });
  });

  it("retries text posts with a refreshed crumb after 403", async () => {
    resetHarness();
    postBehavior = async () => {
      if (postAttempts.length === 1) {
        throw new JenkinsRequestError("Jenkins API request failed (403 Forbidden)", 403);
      }
      return "validated";
    };

    const client = new JenkinsHttpClient({ baseUrl: BASE_URL });
    const result = await client.requestPostTextWithCrumbRaw(
      `${BASE_URL}pipeline-model-converter/validate`,
      "jenkinsfile=pipeline",
      { "Content-Type": "application/x-www-form-urlencoded" }
    );

    assert.equal(result, "validated");
    assert.equal(crumbFetches, 2);
    assert.equal(postAttempts.length, 2);
    assert.equal(postAttempts[0].headers?.["Jenkins-Crumb"], "crumb-1");
    assert.equal(postAttempts[1].headers?.["Jenkins-Crumb"], "crumb-2");
  });

  it("returns response text for accepted error statuses", async () => {
    resetHarness();
    postBehavior = async () => {
      throw new JenkinsRequestError("Jenkins API request failed (404 Not Found)", 404, "missing");
    };

    const client = new JenkinsHttpClient({ baseUrl: BASE_URL });
    const result = await client.requestPostTextWithCrumbRaw(
      `${BASE_URL}pipeline-model-converter/validateJenkinsfile`,
      "jenkinsfile=pipeline",
      { "Content-Type": "application/x-www-form-urlencoded" },
      { acceptErrorStatuses: [404] }
    );

    assert.equal(result, "missing");
    assert.equal(crumbFetches, 1);
    assert.equal(postAttempts.length, 1);
  });

  it("returns response text for accepted error statuses after refreshing the crumb", async () => {
    resetHarness();
    postBehavior = async () => {
      if (postAttempts.length === 1) {
        throw new JenkinsRequestError("Jenkins API request failed (403 Forbidden)", 403);
      }
      throw new JenkinsRequestError("Jenkins API request failed (404 Not Found)", 404, "missing");
    };

    const client = new JenkinsHttpClient({ baseUrl: BASE_URL });
    const result = await client.requestPostTextWithCrumbRaw(
      `${BASE_URL}pipeline-model-converter/validateJenkinsfile`,
      "jenkinsfile=pipeline",
      { "Content-Type": "application/x-www-form-urlencoded" },
      { acceptErrorStatuses: [404] }
    );

    assert.equal(result, "missing");
    assert.equal(crumbFetches, 2);
    assert.equal(postAttempts.length, 2);
  });

  it("throws unaccepted error statuses after refreshing the crumb", async () => {
    resetHarness();
    const notFoundError = new JenkinsRequestError(
      "Jenkins API request failed (404 Not Found)",
      404,
      "missing"
    );
    postBehavior = async () => {
      if (postAttempts.length === 1) {
        throw new JenkinsRequestError("Jenkins API request failed (403 Forbidden)", 403);
      }
      throw notFoundError;
    };

    const client = new JenkinsHttpClient({ baseUrl: BASE_URL });
    await assert.rejects(
      client.requestPostTextWithCrumbRaw(
        `${BASE_URL}pipeline-model-converter/validateJenkinsfile`,
        "jenkinsfile=pipeline",
        { "Content-Type": "application/x-www-form-urlencoded" },
        { acceptErrorStatuses: [405] }
      ),
      (error: unknown) => error === notFoundError
    );
    assert.equal(crumbFetches, 2);
    assert.equal(postAttempts.length, 2);
  });
});

function resetHarness(): void {
  crumbFetches = 0;
  postAttempts = [];
  postBehavior = async () => "";
  bufferRequest.mockClear();
  streamRequest.mockClear();
}
