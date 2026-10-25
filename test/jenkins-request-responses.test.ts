import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, it } from "vitest";
import { JenkinsMaxBytesError } from "../src/jenkins/errors";
import {
  buildRequestResponsePlan,
  decodeAndMaterializeResponse
} from "../src/jenkins/request/responses";

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

  it("applies the same byte limit to buffer and text responses", async () => {
    for (const mode of [{ returnBuffer: true }, { returnText: true }]) {
      const fitting = createResponse();
      const fittingResult = decodeAndMaterializeResponse<Buffer | string>(
        fitting,
        200,
        { parseJson: false, ...mode, maxBytes: 5 },
        "requireSuccessStatus"
      );
      fitting.write("he");
      fitting.end("llo");
      assert.equal(Buffer.from(await fittingResult).toString("utf8"), "hello");

      const oversized = createResponse();
      const oversizedResult = decodeAndMaterializeResponse<Buffer | string>(
        oversized,
        200,
        { parseJson: false, ...mode, maxBytes: 5 },
        "requireSuccessStatus"
      );
      oversized.write("hello world");
      await assert.rejects(
        oversizedResult,
        (error) => error instanceof JenkinsMaxBytesError && error.maxBytes === 5
      );

      const declared = createResponse();
      declared.headers = { "content-length": "11" };
      await assert.rejects(
        decodeAndMaterializeResponse<Buffer | string>(
          declared,
          200,
          { parseJson: false, ...mode, maxBytes: 5 },
          "requireSuccessStatus"
        ),
        (error) => error instanceof JenkinsMaxBytesError && error.maxBytes === 5
      );
    }
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

describe("buildRequestResponsePlan", () => {
  const cannotFollow = { type: "cannotFollow" } as const;
  const cases = [
    {
      name: "resolves immediately for an unfollowable redirect without a return flag",
      options: { parseJson: false },
      redirectDecision: cannotFollow,
      expected: { type: "resolveImmediately" }
    },
    {
      name: "collects without a status check for an unfollowable redirect returning text",
      options: { parseJson: false, returnText: true },
      redirectDecision: cannotFollow,
      expected: { type: "collectAndMaterialize", statusPolicy: "skipStatusCheck" }
    },
    {
      name: "requires success status for an unfollowable redirect parsing JSON",
      options: { parseJson: true },
      redirectDecision: cannotFollow,
      expected: { type: "collectAndMaterialize", statusPolicy: "requireSuccessStatus" }
    },
    {
      name: "requires success status when there is no redirect",
      options: { parseJson: false },
      redirectDecision: { type: "none" },
      expected: { type: "collectAndMaterialize", statusPolicy: "requireSuccessStatus" }
    }
  ] as const;

  for (const { name, options, redirectDecision, expected } of cases) {
    it(name, () => {
      assert.deepEqual(buildRequestResponsePlan(options, redirectDecision), expected);
    });
  }
});
