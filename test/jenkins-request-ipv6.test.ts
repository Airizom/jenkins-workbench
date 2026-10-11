import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import * as realHttp from "node:http";
import { PassThrough } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, it, vi } from "vitest";

const http = { ...realHttp };
vi.doMock("node:http", () => http);
const { requestStream, requestText } = await import("../src/jenkins/request");

describe("IPv6 Jenkins requests", () => {
  it.each(["standard", "streaming"])(
    "uses an unbracketed IPv6 hostname for %s requests",
    async (mode) => {
      let requestOptions: RequestOptions | undefined;
      const response = new PassThrough() as PassThrough & IncomingMessage;
      response.statusCode = 200;
      response.headers = {};
      const originalRequest = http.request;
      http.request = ((options: RequestOptions, callback: (res: IncomingMessage) => void) => {
        requestOptions = options;
        const request = new EventEmitter() as ClientRequest;
        request.end = (() => {
          setImmediate(() => {
            callback(response);
            response.end("ipv6-response");
          });
          return request;
        }) as ClientRequest["end"];
        return request;
      }) as typeof http.request;

      try {
        const path = "/job/example/api/json?depth=1";
        const url = `http://[::1]:8080${path}`;
        const body =
          mode === "standard"
            ? await requestText(url, { timeoutMs: 1000 })
            : await text((await requestStream(url, { timeoutMs: 1000 })).stream);

        assert.equal(body, "ipv6-response");
        assert.equal(requestOptions?.hostname, "::1");
        assert.equal(requestOptions?.port, "8080");
        assert.equal(requestOptions?.path, path);
      } finally {
        http.request = originalRequest;
        response.destroy();
      }
    }
  );
});
