import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RestartFromStageClient } from "../src/jenkins/client/RestartFromStageClient";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

interface RestartHarness {
  client: RestartFromStageClient;
  modernRequests: string[];
  legacyRequests: Array<{ url: string; body?: string | Uint8Array }>;
}

function createRestartHarness(modernResponse?: string): RestartHarness {
  const modernRequests: string[] = [];
  const legacyRequests: Array<{ url: string; body?: string | Uint8Array }> = [];
  const context = createJenkinsClientContext({
    requestPostWithCrumb: async (url, body) => {
      legacyRequests.push({ url, body });
      return {};
    },
    requestPostWithCrumbRaw: async () => ({}),
    requestPostTextWithCrumbRaw: async (url) => {
      modernRequests.push(url);
      if (modernResponse !== undefined) {
        return modernResponse;
      }
      throw new JenkinsRequestError("Not Found", 404, "");
    }
  });
  return { client: new RestartFromStageClient(context), modernRequests, legacyRequests };
}

describe("RestartFromStageClient", () => {
  it("falls back to the legacy restart URL when the modern endpoint returns 404", async () => {
    const { client, modernRequests, legacyRequests } = createRestartHarness();

    await client.restartPipelineFromStage("https://jenkins.example.com/job/demo/15/", "Deploy");

    assert.deepEqual(modernRequests, [
      "https://jenkins.example.com/job/demo/15/restart/restartPipeline"
    ]);
    assert.deepEqual(legacyRequests, [
      {
        url: "https://jenkins.example.com/job/demo/15/restart/restart",
        body: "stageName=Deploy"
      }
    ]);
  });

  it("does not fall back when a structured rejection contains HTTP-like text", async () => {
    const { client, legacyRequests } = createRestartHarness(
      JSON.stringify({ success: false, message: "Stage 404 not found" })
    );

    await assert.rejects(
      client.restartPipelineFromStage("https://jenkins.example.com/job/demo/15/", "Deploy"),
      /Stage 404 not found/
    );

    assert.deepEqual(legacyRequests, []);
  });

  it("accepts a structured success status with a descriptive message", async () => {
    const { client, legacyRequests } = createRestartHarness(
      JSON.stringify({ status: "success", message: "Restart scheduled" })
    );

    await client.restartPipelineFromStage("https://jenkins.example.com/job/demo/15/", "Deploy");

    assert.deepEqual(legacyRequests, []);
  });
});
