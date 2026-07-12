import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { JenkinsBuildConsoleClient } from "../src/jenkins/client/JenkinsBuildConsoleClient";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

describe("JenkinsBuildConsoleClient", () => {
  it.each([404, 405])("falls back when progressive HEAD returns %s", async (statusCode) => {
    const requestText = vi.fn(async () => "complete console text");
    const client = new JenkinsBuildConsoleClient(
      createJenkinsClientContext({
        requestHeaders: async () => {
          throw new JenkinsRequestError("Progressive HEAD unsupported", statusCode);
        },
        requestText
      })
    );

    const result = await client.getConsoleTextTail("https://jenkins.example.com/job/test/1/", 4);

    assert.equal(result.text, "text");
    assert.equal(result.progressiveSupported, false);
    assert.equal(requestText.mock.calls.length, 1);
  });

  it.each([
    ["timeout", new Error("Request timed out")],
    ["authentication failure", new JenkinsRequestError("Unauthorized", 401)],
    ["server failure", new JenkinsRequestError("Internal Server Error", 500)]
  ])("propagates a %s without downloading the complete log", async (_name, error) => {
    const requestText = vi.fn(async () => "complete console text");
    const client = new JenkinsBuildConsoleClient(
      createJenkinsClientContext({
        requestHeaders: async () => {
          throw error;
        },
        requestText
      })
    );

    await assert.rejects(
      client.getConsoleTextTail("https://jenkins.example.com/job/test/1/", 4),
      (thrown) => thrown === error
    );
    assert.equal(requestText.mock.calls.length, 0);
  });
});
