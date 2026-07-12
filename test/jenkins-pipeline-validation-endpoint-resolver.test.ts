import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsPipelineValidationEndpointResolver } from "../src/jenkins/client/JenkinsPipelineValidationEndpointResolver";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const JSON_URL = "https://jenkins.example.com/pipeline-model-converter/validateJenkinsfile";

describe("JenkinsPipelineValidationEndpointResolver", () => {
  for (const statusCode of [404, 405]) {
    it(`selects and caches the text endpoint for an empty ${statusCode} response`, async () => {
      const request = vi.fn(async () => {
        throw new JenkinsRequestError("Validation endpoint unavailable", statusCode, "");
      });
      const resolver = new JenkinsPipelineValidationEndpointResolver(
        createJenkinsClientContext({ requestPostTextWithCrumbRaw: request })
      );

      assert.deepEqual(await resolver.resolve(JSON_URL, "jenkinsfile=pipeline", {}), {
        endpoint: "text"
      });
      assert.deepEqual(await resolver.resolve(JSON_URL, "jenkinsfile=pipeline", {}), {
        endpoint: "text"
      });
      assert.equal(request.mock.calls.length, 1);
    });
  }

  it("keeps the JSON endpoint when a successful diagnostic mentions 404 and not found", async () => {
    const response = JSON.stringify({ status: "error", data: { result: "HTTP 404: not found" } });
    const request = vi.fn(async () => response);
    const resolver = new JenkinsPipelineValidationEndpointResolver(
      createJenkinsClientContext({ requestPostTextWithCrumbRaw: request })
    );

    assert.deepEqual(await resolver.resolve(JSON_URL, "jenkinsfile=pipeline", {}), {
      endpoint: "json",
      response
    });
    assert.deepEqual(await resolver.resolve(JSON_URL, "jenkinsfile=pipeline", {}), {
      endpoint: "json"
    });
    assert.equal(request.mock.calls.length, 1);
  });
});
