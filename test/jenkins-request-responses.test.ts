import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
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
  it("rejects oversized text responses when maxBytes is set", async () => {
    const response = createResponse();
    const result = decodeAndMaterializeResponse<string>(
      response,
      200,
      { parseJson: false, returnText: true, maxBytes: 5 },
      "requireSuccessStatus"
    );

    response.write("hello world");

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
});
