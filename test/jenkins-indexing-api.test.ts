import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { Readable } from "node:stream";
import { describe, it, vi } from "vitest";
import { JenkinsIndexingApi } from "../src/jenkins/client/JenkinsIndexingApi";
import { JenkinsJobsApi } from "../src/jenkins/client/JenkinsJobsApi";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { JenkinsClient } from "../src/jenkins/JenkinsClient";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const FOLDER = "https://jenkins.example/jenkins/job/team/job/repository/";

function response(text: string | Buffer, headers: IncomingHttpHeaders = {}) {
  const body = Buffer.isBuffer(text) ? text : Buffer.from(text);
  const stream = Readable.from([body]);
  return {
    stream,
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "content-length": String(body.length),
      ...headers
    },
    abort: vi.fn(() => stream.destroy())
  };
}

function progressive(body: string, moreData?: string) {
  const bytes = Buffer.from(body);
  const requestStream = vi.fn(async (url: string, _options?: { signal?: AbortSignal }) => {
    const offset = Number(new URL(url).searchParams.get("start"));
    return response(bytes.subarray(offset), {
      "x-text-size": String(bytes.length),
      ...(moreData === undefined ? {} : { "x-more-data": moreData })
    });
  });
  return {
    requestStream,
    api: new JenkinsIndexingApi(createJenkinsClientContext({ requestStream }))
  };
}

describe("Jenkins indexing log API", () => {
  it.each([undefined, "false"])(
    "recognizes completed progressive logs with header %s",
    async (header) => {
      const { api, requestStream } = progressive("Started\nFinished: SUCCESS\n", header);
      const result = await api.getMultibranchScanLog(FOLDER);
      assert.equal(result.moreData, false);
      assert.equal(result.source, "progressive");
      assert.equal(result.text, "Started\nFinished: SUCCESS\n");
      assert.equal(result.prefix, result.text);
      assert.equal(result.truncated, false);
      assert.equal(
        requestStream.mock.calls[0][0],
        `${FOLDER}indexing/logText/progressiveText?start=0`
      );
    }
  );

  it("preserves the empty active response for a not-yet-created log", async () => {
    const { api } = progressive("", "true");
    const result = await api.getMultibranchScanLog(FOLDER);
    assert.equal(result.moreData, true);
    assert.equal(result.textSize, 0);
    assert.equal(result.text, "");
  });

  it("does not treat an invalid completion header as completed", async () => {
    const { api } = progressive("still scanning\n", "unrecognized");
    assert.equal((await api.getMultibranchScanLog(FOLDER)).moreData, undefined);
  });

  it.each(["é", "😀"])("returns a bounded tail with byte offsets for %s", async (character) => {
    const body = `${character.repeat(3000)}\nFinished: SUCCESS\n`;
    const { api, requestStream } = progressive(body);
    const result = await api.getMultibranchScanLog(FOLDER, { maxChars: 80 });
    assert.equal(result.text, Array.from(body).slice(-80).join(""));
    assert.equal(result.textSize, Buffer.byteLength(body));
    assert.equal(result.moreData, false);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.prefix) <= 4096);
    assert.equal(result.prefix.includes("�"), false);
    assert.equal(result.text.includes("�"), false);
    assert.equal(
      Number(new URL(requestStream.mock.calls[1][0]).searchParams.get("start")),
      Buffer.byteLength(body) - 323
    );
  });

  it("retains raw console notes without altering server offsets", async () => {
    const body = "é\u001b[8mha:encoded\u001b[0m\nFinished: FAILURE\n";
    const { api } = progressive(body);
    const result = await api.getMultibranchScanLog(FOLDER);
    assert.equal(result.text, body);
    assert.equal(result.textSize, Buffer.byteLength(body));
  });

  it("finishes newline-heavy tails when Jenkins normalizes raw LF bytes to CRLF", async () => {
    const body = Buffer.from(`${"\né😀".repeat(4000)}\nFinished: SUCCESS\n`);
    const starts: number[] = [];
    const api = new JenkinsIndexingApi(
      createJenkinsClientContext({
        requestStream: async (url) => {
          const start = Number(new URL(url).searchParams.get("start"));
          starts.push(start);
          const normalized = body.subarray(start).toString("utf8").replaceAll("\n", "\r\n");
          return response(normalized, { "x-text-size": String(body.length) });
        }
      })
    );
    const result = await api.getMultibranchScanLog(FOLDER, { maxChars: 70 });
    assert.equal(result.moreData, false);
    assert.equal(result.textSize, body.length);
    assert.equal(
      result.text,
      Array.from(body.toString("utf8").replaceAll("\n", "\r\n")).slice(-70).join("")
    );
    assert.equal(result.text.includes("�"), false);
    assert.equal(starts[1], body.length - 283);
  });

  it("bounds all reads and clamps callers to the console limit", async () => {
    const body = `${"x".repeat(2_000_000)}\nFinished: SUCCESS\n`;
    const { api, requestStream } = progressive(body);
    const result = await api.getMultibranchScanLog(FOLDER, { maxChars: 10_000_000 });
    assert.equal(result.text.length, 200_000);
    assert.equal(result.truncated, true);
    const first = await requestStream.mock.results[0].value;
    assert.equal(first.abort.mock.calls.length, 1);
    assert.equal(
      Number(new URL(requestStream.mock.calls[1][0]).searchParams.get("start")),
      Buffer.byteLength(body) - 800_003
    );
  });

  it.each([404, 405, 501])(
    "uses a bounded snapshot when progressive returns %s",
    async (statusCode) => {
      const requestStream = vi.fn(async (url: string) => {
        if (url.includes("progressiveText")) {
          throw new JenkinsRequestError("unsupported", statusCode);
        }
        return response("old log\nFinished: SUCCESS\n");
      });
      const api = new JenkinsIndexingApi(createJenkinsClientContext({ requestStream }));
      const result = await api.getMultibranchScanLog(FOLDER);
      assert.equal(result.source, "snapshot");
      assert.equal(result.moreData, undefined);
      assert.equal(result.text, "old log\nFinished: SUCCESS\n");
      assert.equal(requestStream.mock.calls[1][0], `${FOLDER}indexing/consoleText`);
    }
  );

  it.each([undefined, "NaN", "1garbage", "-1", "9007199254740993"])(
    "does not trust invalid size %s",
    async (size) => {
      const requestStream = vi.fn(async (url: string) =>
        response(
          "text",
          url.includes("progressiveText") && size !== undefined ? { "x-text-size": size } : {}
        )
      );
      const api = new JenkinsIndexingApi(createJenkinsClientContext({ requestStream }));
      const result = await api.getMultibranchScanLog(FOLDER);
      assert.equal(result.moreData, undefined);
      assert.equal(result.source, "snapshot");
      assert.equal(requestStream.mock.calls.length, 2);
    }
  );

  it("bounds fallback bodies and never treats a truncated footer as completion", async () => {
    const requestStream = vi.fn(async () => response("x".repeat(2_000_000)));
    const api = new JenkinsIndexingApi(createJenkinsClientContext({ requestStream }));
    const result = await api.getMultibranchScanLog(FOLDER, { maxChars: 50 });
    assert.equal(result.text.length, 50);
    assert.equal(result.textSize, 203);
    assert.equal(result.truncated, true);
    assert.equal(result.moreData, undefined);
    assert.equal((await requestStream.mock.results[1].value).abort.mock.calls.length, 1);
  });

  it.each([401, 403, 500])(
    "preserves HTTP %s errors instead of disguising them as missing logs",
    async (status) => {
      const error = new JenkinsRequestError("denied", status);
      const requestStream = vi.fn(async () => {
        throw error;
      });
      const api = new JenkinsIndexingApi(createJenkinsClientContext({ requestStream }));
      await assert.rejects(api.getMultibranchScanLog(FOLDER), error);
      assert.equal(requestStream.mock.calls.length, 1);
    }
  );

  it("rejects a login page and releases the response", async () => {
    const html = response("<html>Sign in</html>", { "content-type": "text/html" });
    const api = new JenkinsIndexingApi(
      createJenkinsClientContext({ requestStream: async () => html })
    );
    await assert.rejects(api.getMultibranchScanLog(FOLDER), /HTML page/);
    assert.equal(html.abort.mock.calls.length, 1);
  });

  it("rejects a log that shrinks between prefix and tail reads", async () => {
    let calls = 0;
    const api = new JenkinsIndexingApi(
      createJenkinsClientContext({
        requestStream: async () =>
          ++calls === 1
            ? response("x".repeat(5000), { "x-text-size": "5000" })
            : response("new", { "x-text-size": "3", "x-more-data": "true" })
      })
    );
    await assert.rejects(api.getMultibranchScanLog(FOLDER), /changed while reading/);
  });

  it("rejects an equally sized replacement between prefix and tail reads", async () => {
    let calls = 0;
    const api = new JenkinsIndexingApi(
      createJenkinsClientContext({
        requestStream: async (url) => {
          const start = Number(new URL(url).searchParams.get("start"));
          const body = Buffer.from((++calls === 1 ? "old" : "new").repeat(2000));
          return response(body.subarray(start), { "x-text-size": String(body.length) });
        }
      })
    );
    await assert.rejects(
      api.getMultibranchScanLog(FOLDER, { maxChars: 80 }),
      /changed while reading/
    );
    assert.equal(calls, 3);
  });

  it("rejects a new active log even if its prefix matches the completed tail", async () => {
    let calls = 0;
    const api = new JenkinsIndexingApi(
      createJenkinsClientContext({
        requestStream: async (url) => {
          const start = Number(new URL(url).searchParams.get("start"));
          const body = Buffer.from("same prefix".repeat(600));
          return response(body.subarray(start), {
            "x-text-size": String(body.length),
            ...(++calls === 3 ? { "x-more-data": "true" } : {})
          });
        }
      })
    );
    await assert.rejects(
      api.getMultibranchScanLog(FOLDER, { maxChars: 80 }),
      /changed while reading/
    );
  });

  it("does not report completion if output exceeds the tail request budget", async () => {
    let calls = 0;
    const api = new JenkinsIndexingApi(
      createJenkinsClientContext({
        requestStream: async () =>
          response("x".repeat(5000), { "x-text-size": String(++calls === 1 ? 5000 : 10000) })
      })
    );
    const result = await api.getMultibranchScanLog(FOLDER, { maxChars: 5 });
    assert.equal(result.moreData, undefined);
    assert.equal(result.truncated, true);
  });

  it("propagates cancellation and never starts requests for an aborted signal", async () => {
    const { api, requestStream } = progressive("text");
    const controller = new AbortController();
    await api.getMultibranchScanLog(FOLDER, { signal: controller.signal });
    assert.equal(requestStream.mock.calls[0][1]?.signal, controller.signal);
    controller.abort();
    await assert.rejects(api.getMultibranchScanLog(FOLDER, { signal: controller.signal }), {
      name: "AbortError"
    });
    assert.equal(requestStream.mock.calls.length, 1);
  });

  it("keeps fingerprints stable across polls but changes them for replaced logs", async () => {
    const { api } = progressive("Finished: SUCCESS\n");
    const first = await api.getMultibranchScanLog(FOLDER);
    assert.equal((await api.getMultibranchScanLog(FOLDER)).fingerprint, first.fingerprint);
    const failed = await progressive("Finished: FAILURE\n").api.getMultibranchScanLog(FOLDER);
    assert.notEqual(failed.fingerprint, first.fingerprint);
  });
});

describe("multibranch scan submission", () => {
  it.each([undefined, "/queue/item/12/", "/job/team/", "https://jenkins.example/queue/item/2/"])(
    "retains Location %s without inferring scan status",
    async (location) => {
      const requestPostWithCrumb = vi.fn(async () => ({ location }));
      const api = new JenkinsJobsApi(createJenkinsClientContext({ requestPostWithCrumb }));
      assert.deepEqual(await api.scanMultibranch(FOLDER), { queueLocation: location });
      assert.deepEqual(requestPostWithCrumb.mock.calls[0], [`${FOLDER}build`]);
    }
  );
});

describe("indexing HTTP facade", () => {
  it("reads an authenticated progressive tail through the uncached data service", async () => {
    const content = Buffer.from(`${"é".repeat(3000)}\nFinished: SUCCESS\n`);
    const requests: Array<{ url: string; authorization?: string }> = [];
    const server = createServer((request, reply) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      requests.push({ url: request.url ?? "/", authorization: request.headers.authorization });
      const start = Number(url.searchParams.get("start"));
      const body = content.subarray(start);
      reply.writeHead(200, {
        "Content-Type": "text/plain;charset=UTF-8",
        "Content-Length": body.length,
        "X-Text-Size": content.length
      });
      reply.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/jenkins/`;
      const client = new JenkinsClient({
        baseUrl: url,
        authConfig: { type: "basic", username: "user", token: "token" }
      });
      const getClient = vi.fn(async () => client);
      const data = new JenkinsDataService({ getClient } as unknown as JenkinsClientProvider, {
        buildParameterRequestPreparer: {
          prepareBuildParameters: async () => ({ hasParameters: false })
        }
      });
      const environment = { environmentId: "env", scope: "workspace" as const, url };
      const folderUrl = `${url}job/team/job/repository/`;
      const first = await data.getMultibranchScanLog(environment, folderUrl, { maxChars: 80 });
      const second = await data.getMultibranchScanLog(environment, folderUrl, { maxChars: 80 });
      assert.equal(first.moreData, false);
      assert.equal(first.text, Array.from(content.toString()).slice(-80).join(""));
      assert.equal(second.fingerprint, first.fingerprint);
      assert.equal(getClient.mock.calls.length, 2);
      assert.equal(requests.length, 6);
      assert.ok(
        requests.every(
          (request) =>
            request.authorization === `Basic ${Buffer.from("user:token").toString("base64")}`
        )
      );
      assert.match(
        requests[0].url,
        /^\/jenkins\/job\/team\/job\/repository\/indexing\/logText\/progressiveText\?start=0$/
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
