import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RestartFromStageClient } from "../src/jenkins/client/RestartFromStageClient";
import { RestartFromStageResponseParser } from "../src/jenkins/client/RestartFromStageResponseParser";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

interface RestartHarness {
  client: RestartFromStageClient;
  modernRequests: string[];
  modernRequestBodies: string[];
  legacyRequests: Array<{ url: string; body?: string | Uint8Array }>;
}

function createRestartHarness(modernResponse?: string): RestartHarness {
  const modernRequests: string[] = [];
  const modernRequestBodies: string[] = [];
  const legacyRequests: Array<{ url: string; body?: string | Uint8Array }> = [];
  const context = createJenkinsClientContext({
    requestPostWithCrumb: async (url, body) => {
      legacyRequests.push({ url, body });
      return {};
    },
    requestPostWithCrumbRaw: async () => ({}),
    requestPostTextWithCrumbRaw: async (url, body) => {
      modernRequests.push(url);
      if (typeof body !== "string") {
        throw new Error("Expected a string restart request body.");
      }
      modernRequestBodies.push(body);
      if (modernResponse !== undefined) {
        return modernResponse;
      }
      throw new JenkinsRequestError("Not Found", 404, "");
    }
  });
  return {
    client: new RestartFromStageClient(context),
    modernRequests,
    modernRequestBodies,
    legacyRequests
  };
}

describe("RestartFromStageResponseParser", () => {
  it("preserves distinct nonblank stage identifiers exactly", () => {
    const parser = new RestartFromStageResponseParser();

    const result = parser.parseRestartFromStageInfo({
      restartableStages: ["Build", " Build ", "Build", "   "]
    });

    assert.deepEqual(result.restartableStages, ["Build", " Build "]);
  });
});

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

  it("submits the exact nonblank stage identifier", async () => {
    const { client, modernRequestBodies } = createRestartHarness(JSON.stringify({ success: true }));

    await client.restartPipelineFromStage("https://jenkins.example.com/job/demo/15/", " Build ");

    assert.equal(new URLSearchParams(modernRequestBodies[0]).get("stageName"), " Build ");
  });

  it("rejects a whitespace-only stage identifier", async () => {
    const { client, modernRequests } = createRestartHarness();

    await assert.rejects(
      client.restartPipelineFromStage("https://jenkins.example.com/job/demo/15/", "   "),
      /A stage name is required/
    );
    assert.deepEqual(modernRequests, []);
  });
});
