import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it, vi } from "vitest";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsSimpleRequestOptions } from "../src/jenkins/request";

const BASE_URL = "https://jenkins.example.com/";

interface PostRequestOptions extends JenkinsSimpleRequestOptions {
  method?: string;
  body?: string | Uint8Array;
}

interface TextPostAttempt {
  url: string;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  options?: PostRequestOptions;
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
      headers: { "set-cookie": [`JSESSIONID=session-${crumbFetches}; Path=/; HttpOnly`] }
    };
  },
  requestVoidWithLocation: async (url: string, options?: PostRequestOptions) => {
    const attempt = { url, body: options?.body, headers: options?.headers, options };
    postAttempts.push(attempt);
    await postBehavior(attempt);
    return {};
  },
  requestText: async (url: string, options?: PostRequestOptions): Promise<string> => {
    const attempt = { url, body: options?.body, headers: options?.headers, options };
    postAttempts.push(attempt);
    return postBehavior(attempt);
  }
};

vi.doMock("../src/jenkins/request", () => requestMock);
const { JenkinsHttpClient } = await import("../src/jenkins/client/JenkinsHttpClient");

describe("JenkinsHttpClient crumb retry", () => {
  it.each(["post", "void", "raw", "text"] as const)(
    "preserves authentication cookies with fresh session cookies on %s posts and retries",
    async (method) => {
      resetHarness();
      postBehavior = async () => {
        if (postAttempts.length === 1) {
          throw new JenkinsRequestError("Jenkins API request failed (403 Forbidden)", 403);
        }
        return "validated";
      };
      const client = new JenkinsHttpClient({
        baseUrl: BASE_URL,
        authConfig: {
          type: "headers",
          headers: { cOoKiE: "auth=secret; JSESSIONID=stale", "X-Auth": "token" }
        }
      });
      const url = `${BASE_URL}job/example/build`;
      switch (method) {
        case "post":
          await client.requestPostWithCrumb(url);
          break;
        case "void":
          await client.requestVoidWithCrumb(url);
          break;
        case "raw":
          await client.requestPostWithCrumbRaw(url, "body", { cookie: "preference=compact" });
          break;
        case "text":
          await client.requestPostTextWithCrumbRaw(url, "body", { cookie: "preference=compact" });
          break;
      }

      assert.equal(crumbFetches, 2);
      assert.equal(postAttempts.length, 2);
      for (const [index, attempt] of postAttempts.entries()) {
        const suffix = method === "raw" || method === "text" ? "; preference=compact" : "";
        assert.equal(
          attempt.headers?.Cookie,
          `auth=secret; JSESSIONID=session-${index + 1}${suffix}`
        );
        assert.equal(attempt.headers?.["Jenkins-Crumb"], `crumb-${index + 1}`);
        assert.equal(attempt.headers?.["X-Auth"], "token");
        assert.deepEqual(
          Object.keys(attempt.headers ?? {}).filter((name) => name.toLowerCase() === "cookie"),
          ["Cookie"]
        );
      }
    }
  );

  it.each(["post", "text"] as const)(
    "forwards auth, timeout, and context options on %s posts",
    async (method) => {
      resetHarness();
      const client = new JenkinsHttpClient({
        baseUrl: BASE_URL,
        username: "alice",
        token: "api-token",
        requestTimeoutMs: 1234
      });
      const url = `${BASE_URL}job/example/build`;
      if (method === "post") {
        await client.requestPostWithCrumb(url, "a=1");
      } else {
        await client.requestPostTextWithCrumbRaw(url, "a=1");
      }

      assert.equal(postAttempts.length, 1);
      const options = postAttempts[0].options;
      assert.equal(options?.method, "POST");
      assert.equal(options?.body, "a=1");
      assert.equal(
        options?.authHeader,
        `Basic ${Buffer.from("alice:api-token").toString("base64")}`
      );
      assert.equal(options?.timeoutMs, 1234);
      assert.equal(options?.contextUrl, BASE_URL);
      assert.equal(options?.headers?.["Jenkins-Crumb"], "crumb-1");
    }
  );

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
      contextUrl: BASE_URL,
      maxBytes: 100
    });
    assert.deepEqual(streamRequest.mock.calls[0]?.[1], {
      authHeader: undefined,
      headers: { "X-Auth-Token": "secret" },
      timeoutMs: undefined,
      contextUrl: BASE_URL,
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
