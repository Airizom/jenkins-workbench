import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import * as realHttp from "node:http";
import { PassThrough } from "node:stream";
import { describe, it, vi } from "vitest";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../src/jenkins/errors";

// `node:http` resolves to an immutable ES module namespace under vitest, so the
// `http.request` monkeypatch below can only work against a mutable copy that the
// module under test also imports.
const http = { ...realHttp };
vi.doMock("node:http", () => http);
const { requestJenkinsStream } = await import("../src/jenkins/request/streamRequest");

type TestResponse = IncomingMessage & PassThrough;

function createResponse(): TestResponse {
  const response = new PassThrough() as unknown as TestResponse;
  response.headers = { "content-type": "text/plain" };
  response.statusCode = 200;
  response.statusMessage = "OK";
  return response;
}

function createRequest(onEnd: () => void): ClientRequest {
  const request = new EventEmitter() as ClientRequest;
  request.write = (() => true) as ClientRequest["write"];
  request.end = (() => {
    setImmediate(onEnd);
    return request;
  }) as ClientRequest["end"];
  request.destroy = ((error?: Error) => {
    if (error) {
      request.emit("error", error);
    }
    request.emit("close");
    return request;
  }) as ClientRequest["destroy"];
  return request;
}

function mockHttpRequest(response: IncomingMessage): () => void {
  const originalRequest = http.request;
  const fakeRequest = ((...args: unknown[]) => {
    const callback = args.find(
      (arg): arg is (incoming: IncomingMessage) => void => typeof arg === "function"
    );
    return createRequest(() => callback?.(response));
  }) as typeof http.request;

  Object.defineProperty(http, "request", { value: fakeRequest });
  return () => Object.defineProperty(http, "request", { value: originalRequest });
}

function waitForStreamError(stream: NodeJS.ReadableStream): Promise<Error> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for stream error."));
    }, 1000);
    const onError = (error: Error): void => {
      cleanup();
      resolve(error);
    };
    const onEnd = (): void => {
      cleanup();
      reject(new Error("Stream ended before timeout error."));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      stream.off("error", onError);
      stream.off("end", onEnd);
    };
    stream.once("error", onError);
    stream.once("end", onEnd);
  });
}

describe("requestJenkinsStream", () => {
  it("times out when the response body stalls after successful headers", async () => {
    const response = createResponse();
    const restoreHttpRequest = mockHttpRequest(response);

    try {
      const streamResponse = await requestJenkinsStream("http://jenkins.example/stalled", {
        timeoutMs: 30
      });
      const error = await waitForStreamError(streamResponse.stream);

      assert.ok(error instanceof JenkinsRequestError);
      assert.match(error.message, /timed out after 30ms/i);
    } finally {
      restoreHttpRequest();
      response.destroy();
    }
  });

  it("rejects oversized error response bodies without collecting them", async () => {
    const response = createResponse();
    response.statusCode = 500;
    response.statusMessage = "Internal Server Error";
    const restoreHttpRequest = mockHttpRequest(response);

    try {
      const rejection = assert.rejects(
        requestJenkinsStream("http://jenkins.example/error", {
          maxBytes: 5
        }),
        (error) => error instanceof JenkinsMaxBytesError && error.maxBytes === 5
      );

      await new Promise((resolve) => setImmediate(resolve));
      response.write("123");
      response.write("456");
      response.emit("error", new Error("late response error"));

      await rejection;
    } finally {
      restoreHttpRequest();
      response.destroy();
    }
  });

  it("collects split multibyte error text at the exact byte limit", async () => {
    const response = createResponse();
    response.statusCode = 500;
    response.statusMessage = "Internal Server Error";
    const restoreHttpRequest = mockHttpRequest(response);

    try {
      const result = requestJenkinsStream("http://jenkins.example/error", {
        maxBytes: 4
      });
      const bytes = Buffer.from("🙂");

      await new Promise((resolve) => setImmediate(resolve));
      response.write(bytes.subarray(0, 2));
      response.end(bytes.subarray(2));

      await assert.rejects(
        result,
        (error) => error instanceof JenkinsRequestError && error.responseText === "🙂"
      );
    } finally {
      restoreHttpRequest();
      response.destroy();
    }
  });

  it("returns partial error text when the response transport errors", async () => {
    const response = createResponse();
    response.statusCode = 500;
    response.statusMessage = "Internal Server Error";
    const restoreHttpRequest = mockHttpRequest(response);

    try {
      const result = requestJenkinsStream("http://jenkins.example/error", {});

      await new Promise((resolve) => setImmediate(resolve));
      response.write("partial");
      response.emit("error", new Error("connection reset"));

      await assert.rejects(
        result,
        (error) => error instanceof JenkinsRequestError && error.responseText === "partial"
      );
    } finally {
      restoreHttpRequest();
      response.destroy();
    }
  });
});
