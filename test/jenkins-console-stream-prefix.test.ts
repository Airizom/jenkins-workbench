import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import { describe, it } from "vitest";
import { readTextPrefixFromStream } from "../src/jenkins/client/JenkinsConsoleStream";
import type { JenkinsStreamResponse } from "../src/jenkins/request";

interface StreamFixture {
  response: JenkinsStreamResponse;
  stream: EventEmitter;
  aborts: () => number;
}

function createStreamResponse(headers: IncomingHttpHeaders = {}): StreamFixture {
  const stream = new EventEmitter();
  let abortCount = 0;
  const response: JenkinsStreamResponse = {
    stream: stream as unknown as NodeJS.ReadableStream,
    headers,
    abort: () => {
      abortCount += 1;
    }
  };
  return { response, stream, aborts: () => abortCount };
}

describe("readTextPrefixFromStream", () => {
  it("reads a single-chunk body and reports it complete", async () => {
    const { response, stream, aborts } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 100);
    stream.emit("data", Buffer.from("hello"));
    stream.emit("end");

    const result = await resultPromise;
    assert.deepEqual(result, {
      text: "hello",
      truncated: false,
      bytesRead: 5,
      resumeBytes: 5
    });
    assert.equal(aborts(), 0);
  });

  it("resolves an empty body", async () => {
    const { response, stream } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 100);
    stream.emit("end");

    const result = await resultPromise;
    assert.deepEqual(result, { text: "", truncated: false, bytesRead: 0, resumeBytes: 0 });
  });

  it("concatenates multiple chunks, converting string chunks to bytes", async () => {
    const { response, stream } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 100);
    stream.emit("data", Buffer.from("hello "));
    stream.emit("data", "world");
    stream.emit("end");

    const result = await resultPromise;
    assert.equal(result.text, "hello world");
    assert.equal(result.bytesRead, 11);
    assert.equal(result.truncated, false);
  });

  it("copies chunks into the preallocated buffer when content-length is known", async () => {
    const { response, stream } = createStreamResponse({ "content-length": "11" });

    const resultPromise = readTextPrefixFromStream(response, 100);
    stream.emit("data", Buffer.from("hello "));
    stream.emit("data", Buffer.from("world"));
    stream.emit("end");

    const result = await resultPromise;
    assert.equal(result.text, "hello world");
    assert.equal(result.truncated, false);
    assert.equal(result.resumeBytes, 11);
  });

  it("marks the result truncated when content-length exceeds the byte budget", async () => {
    const { response, stream, aborts } = createStreamResponse({ "content-length": "20" });

    const resultPromise = readTextPrefixFromStream(response, 5);
    stream.emit("data", Buffer.from("hello"));
    stream.emit("close");

    const result = await resultPromise;
    assert.equal(result.text, "hello");
    assert.equal(result.truncated, true);
    assert.equal(result.bytesRead, 5);
    assert.equal(aborts(), 1);
  });

  it("keeps an exact-size body untruncated when it matches content-length", async () => {
    const { response, stream, aborts } = createStreamResponse({ "content-length": "4" });

    const resultPromise = readTextPrefixFromStream(response, 4);
    stream.emit("data", Buffer.from("abcd"));
    stream.emit("end");

    const result = await resultPromise;
    assert.equal(result.text, "abcd");
    assert.equal(result.truncated, false);
    assert.equal(aborts(), 0);
  });

  it("trims an oversized first chunk to the byte budget", async () => {
    const { response, stream, aborts } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 3);
    const source = Buffer.from("abcdef");
    stream.emit("data", source);
    source.fill(0);
    stream.emit("close");

    const result = await resultPromise;
    assert.equal(result.text, "abc");
    assert.equal(result.truncated, true);
    assert.equal(result.bytesRead, 3);
    assert.equal(result.resumeBytes, 3);
    assert.equal(aborts(), 1);
  });

  it("ignores chunks that arrive after the budget is exhausted", async () => {
    const { response, stream, aborts } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 4);
    stream.emit("data", Buffer.from("abcd"));
    stream.emit("data", Buffer.from("extra"));
    stream.emit("end");

    const result = await resultPromise;
    assert.equal(result.text, "abcd");
    assert.equal(result.truncated, true);
    assert.equal(result.bytesRead, 4);
    assert.equal(aborts(), 1);
  });

  it("spills to chunk storage when the body outgrows the content-length header", async () => {
    const { response, stream } = createStreamResponse({ "content-length": "4" });

    const resultPromise = readTextPrefixFromStream(response, 100);
    stream.emit("data", Buffer.from("abcd"));
    stream.emit("data", Buffer.from("efgh"));
    stream.emit("data", Buffer.from("ij"));
    stream.emit("end");

    const result = await resultPromise;
    assert.equal(result.text, "abcdefghij");
    assert.equal(result.truncated, false);
    assert.equal(result.bytesRead, 10);
  });

  it("spills the first chunk when it already exceeds the advertised length", async () => {
    const { response, stream } = createStreamResponse({ "content-length": "2" });

    const resultPromise = readTextPrefixFromStream(response, 100);
    stream.emit("data", Buffer.from("hello"));
    stream.emit("end");

    const result = await resultPromise;
    assert.equal(result.text, "hello");
    assert.equal(result.truncated, false);
    assert.equal(result.bytesRead, 5);
  });

  it("drops a trailing incomplete UTF-8 sequence from a truncated prefix", async () => {
    const { response, stream } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 2);
    stream.emit("data", Buffer.from("aéb"));
    stream.emit("close");

    const result = await resultPromise;
    assert.equal(result.text, "a");
    assert.equal(result.truncated, true);
    assert.equal(result.bytesRead, 2);
    assert.equal(result.resumeBytes, 1);
  });

  it("drops a truncated four-byte UTF-8 sequence entirely", async () => {
    const { response, stream } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 3);
    stream.emit("data", Buffer.from("a\u{1F600}b"));
    stream.emit("close");

    const result = await resultPromise;
    assert.equal(result.text, "a");
    assert.equal(result.bytesRead, 3);
    assert.equal(result.resumeBytes, 1);
  });

  it("drops a prefix that ends in nothing but continuation bytes", async () => {
    const { response, stream } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 2);
    stream.emit("data", Buffer.from([0b1000_0000, 0b1000_0000, 0b1000_0000]));
    stream.emit("close");

    const result = await resultPromise;
    assert.equal(result.text, "");
    assert.equal(result.bytesRead, 2);
    assert.equal(result.resumeBytes, 0);
  });

  it("rejects when the stream emits an error", async () => {
    const { response, stream } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 100);
    stream.emit("data", Buffer.from("partial"));
    stream.emit("error", new Error("boom"));

    await assert.rejects(resultPromise, /boom/);
  });

  it("wraps non-Error stream failures in an Error", async () => {
    const { response, stream } = createStreamResponse();

    const resultPromise = readTextPrefixFromStream(response, 100);
    stream.emit("error", "socket gone");

    await assert.rejects(resultPromise, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "socket gone");
      return true;
    });
  });
});
