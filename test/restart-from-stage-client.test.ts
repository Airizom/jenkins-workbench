import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RestartFromStageClient } from "../src/jenkins/client/RestartFromStageClient";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsClientContext } from "../src/jenkins/client/JenkinsClientContext";

interface RestartHarness {
  client: RestartFromStageClient;
  modernRequests: string[];
  legacyRequests: Array<{ url: string; body?: string | Uint8Array }>;
}

function createRestartHarness(): RestartHarness {
  const modernRequests: string[] = [];
  const legacyRequests: Array<{ url: string; body?: string | Uint8Array }> = [];
  const context: JenkinsClientContext = {
    baseUrl: "https://jenkins.example.com/",
    requestJson: async <T>(): Promise<T> => {
      throw new Error("not implemented");
    },
    requestHeaders: async () => ({}),
    requestText: async () => "",
    requestTextWithHeaders: async () => ({ text: "", headers: {} }),
    requestBufferWithHeaders: async () => ({ data: new Uint8Array(), headers: {} }),
    requestStream: async () => {
      throw new Error("not implemented");
    },
    requestVoidWithCrumb: async () => undefined,
    requestPostWithCrumb: async (url, body) => {
      legacyRequests.push({ url, body });
      return {};
    },
    requestPostWithCrumbRaw: async () => ({}),
    requestPostTextWithCrumbRaw: async (url) => {
      modernRequests.push(url);
      throw new JenkinsRequestError("Not Found", 404, "");
    }
  };
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
});
