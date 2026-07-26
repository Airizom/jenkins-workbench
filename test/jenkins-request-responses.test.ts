import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, it } from "vitest";
import { JenkinsMaxBytesError } from "../src/jenkins/errors";
import { decodeAndMaterializeResponse } from "../src/jenkins/request/responses";

type TestResponse = IncomingMessage & PassThrough;

function createResponse(): TestResponse {
  const response = new PassThrough() as unknown as TestResponse;
  response.headers = {};
  response.statusMessage = "OK";
  return response;
}

describe("Jenkins request response collection", () => {
  it("collects split multibyte text at the exact byte limit", async () => {
    const response = createResponse();
    const result = decodeAndMaterializeResponse<string>(
      response,
      200,
      { parseJson: false, returnText: true, maxBytes: 4 },
      "requireSuccessStatus"
    );
    const bytes = Buffer.from("🙂");

    response.write(bytes.subarray(0, 2));
    response.end(bytes.subarray(2));

    assert.equal(await result, "🙂");
  });

  it("keeps the oversized text rejection after a subsequent end event", async () => {
    const response = createResponse();
    const result = decodeAndMaterializeResponse<string>(
      response,
      200,
      { parseJson: false, returnText: true, maxBytes: 5 },
      "requireSuccessStatus"
    );

    response.write("hello world");
    response.emit("end");

    await assert.rejects(
      result,
      (error) => error instanceof JenkinsMaxBytesError && error.maxBytes === 5
    );
  });

  it("rejects oversized JSON responses when maxBytes is set", async () => {
    const response = createResponse();
    const result = decodeAndMaterializeResponse<{ message: string }>(
      response,
      200,
      { parseJson: true, maxBytes: 8 },
      "requireSuccessStatus"
    );

    response.write('{"message":"too large"}');

    await assert.rejects(
      result,
      (error) => error instanceof JenkinsMaxBytesError && error.maxBytes === 8
    );
  });

  it("rejects transport errors instead of returning partial text", async () => {
    const response = createResponse();
    const result = decodeAndMaterializeResponse<string>(
      response,
      200,
      { parseJson: false, returnText: true },
      "requireSuccessStatus"
    );
    const transportError = new Error("connection reset");

    response.write("partial");
    response.emit("error", transportError);

    await assert.rejects(result, (error) => error === transportError);
  });
});
