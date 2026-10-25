import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it, vi } from "vitest";
import type { JenkinsClientContext } from "../src/jenkins/client/JenkinsClientContext";
import {
  JenkinsNodeLogClient,
  NODE_LOG_MAX_BYTES
} from "../src/jenkins/client/JenkinsNodeLogClient";
import { JenkinsRequestError } from "../src/jenkins/errors";

const nodeUrl = "https://example.com/jenkins/computer/agent/";
function createLog(
  text: string,
  options?: { batchLines?: number; transform?: (text: string) => string }
) {
  let body = Buffer.from(text);
  const requestHeaders = vi.fn(async () => ({ "x-text-size": "0" }));
  const requestStream = vi.fn(async (url: string) => {
    let start = Number(new URL(url).searchParams.get("start"));
    if (start > body.length) start = 0;
    let end = body.length;
    if (options?.batchLines) {
      let cursor = start;
      for (let line = 0; line < options.batchLines; line++) {
        const newline = body.indexOf(10, cursor);
        if (newline < 0) break;
        cursor = newline + 1;
      }
      end = cursor;
    }
    const sourceText = body.subarray(start, end).toString("utf8");
    const output = Buffer.from(options?.transform ? options.transform(sourceText) : sourceText);
    const stream = Readable.from([output]);
    return {
      stream,
      headers: {
        "x-text-size": String(end),
        "x-more-data": "true",
        "content-length": String(output.length)
      },
      abort: () => {
        stream.destroy();
      }
    };
  });
  const context = { requestHeaders, requestStream } as unknown as JenkinsClientContext;
  return {
    log: new JenkinsNodeLogClient(context),
    requestHeaders,
    requestStream,
    setText: (text: string) => {
      body = Buffer.from(text);
    }
  };
}

function starts(requests: { mock: { calls: [string][] } }): number[] {
  return requests.mock.calls.map(([url]) => Number(new URL(url).searchParams.get("start")));
}

describe("bounded progressive agent log", () => {
  it("drains a complete response while retaining only recent output and never seeks using HEAD", async () => {
    const text = `${"x".repeat(NODE_LOG_MAX_BYTES)}tail`;
    const { log, requestStream, requestHeaders } = createLog(text);
    const result = await log.getLog(nodeUrl);
    assert.equal(Buffer.byteLength(result.text), NODE_LOG_MAX_BYTES);
    assert.equal(result.nextStart, text.length);
    assert.equal(result.truncated, true);
    assert.equal(result.reset, false);
    assert.equal(
      new URL(requestStream.mock.calls[0][0]).pathname,
      "/jenkins/computer/agent/logText/progressiveText"
    );
    assert.deepEqual(starts(requestStream), [0, text.length]);
    assert.equal(requestHeaders.mock.calls.length, 0);
  });

  it("retains a valid UTF-8 tail and keeps the server cursor rather than transformed byte counts", async () => {
    const text = `prefix😀${"a".repeat(NODE_LOG_MAX_BYTES - 1)}`;
    const { log } = createLog(text);
    const result = await log.getLog(nodeUrl);
    assert.equal(result.text, "a".repeat(NODE_LOG_MAX_BYTES - 1));
    assert.equal(result.nextStart, Buffer.byteLength(text));
    assert.equal(result.truncated, true);
  });

  it("preserves a legitimately encoded replacement character at the start of the tail", async () => {
    const tail = `�${"a".repeat(NODE_LOG_MAX_BYTES - 3)}`;
    const { log } = createLog(`prefix${tail}`);
    const result = await log.getLog(nodeUrl);
    assert.equal(result.text, tail);
    assert.equal(Buffer.byteLength(result.text), NODE_LOG_MAX_BYTES);
  });

  it("restarts a truncated or replaced log using the server's reset cursor", async () => {
    const { log, setText } = createLog("before");
    const first = await log.getLog(nodeUrl);
    setText("new");
    const result = await log.getLog(nodeUrl, { start: first.nextStart });
    assert.deepEqual(result, { text: "new", nextStart: 3, reset: true, truncated: false });
  });

  it("uses old Jenkins batch cursors through CRLF normalization and annotation removal without skipping new lines", async () => {
    const source = Array.from(
      { length: 20_000 },
      (_, index) => `[annotation]line-${String(index).padStart(5, "0")}\n`
    ).join("");
    const transform = (text: string) =>
      text.replaceAll("[annotation]", "").replaceAll("\n", "\r\n");
    const { log, requestStream, setText } = createLog(source, { batchLines: 10_000, transform });
    const initial = await log.getLog(nodeUrl);
    assert.equal(initial.nextStart, Buffer.byteLength(source));
    assert.equal(initial.reset, false);
    assert.equal(initial.catchingUp, undefined);
    assert.match(initial.text, /line-19999\r\n$/);
    assert.deepEqual(starts(requestStream), [
      0,
      Buffer.byteLength(source) / 2,
      Buffer.byteLength(source)
    ]);
    const appended = Array.from(
      { length: 200 },
      (_, index) => `[annotation]line-${20_000 + index}\n`
    ).join("");
    setText(source + appended);
    const update = await log.getLog(nodeUrl, { start: initial.nextStart });
    assert.equal(update.text, transform(appended));
    assert.equal(update.nextStart, Buffer.byteLength(source + appended));
    assert.equal(update.reset, false);
  });

  it("caps batch traversal and resumes catch-up without treating the first batch cursor as EOF", async () => {
    const source = Array.from({ length: 60_000 }, (_, index) => `${index}\n`).join("");
    const { log, requestStream } = createLog(source, { batchLines: 10_000 });
    const initial = await log.getLog(nodeUrl);
    assert.equal(initial.catchingUp, true);
    assert.equal(requestStream.mock.calls.length, 4);
    assert.match(initial.text, /39999\n$/);
    const caughtUp = await log.getLog(nodeUrl, { start: initial.nextStart });
    assert.equal(caughtUp.nextStart, Buffer.byteLength(source));
    assert.equal(caughtUp.catchingUp, undefined);
    assert.equal(caughtUp.reset, false);
    assert.match(caughtUp.text, /59999\n$/);
    assert.equal(requestStream.mock.calls.length, 7);
  });

  it("surfaces permission failures without falling back to other endpoints", async () => {
    const { log, requestStream } = createLog("text");
    requestStream.mockRejectedValueOnce(new JenkinsRequestError("denied", 403));
    await assert.rejects(log.getLog(nodeUrl), /denied/);
    assert.equal(requestStream.mock.calls.length, 1);
  });

  it("rejects invalid byte offsets and pre-aborted requests", async () => {
    const { log, requestStream } = createLog("text");
    await assert.rejects(log.getLog(nodeUrl, { start: -1 }), /offset/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(log.getLog(nodeUrl, { signal: controller.signal }));
    assert.equal(requestStream.mock.calls.length, 0);
  });
});
