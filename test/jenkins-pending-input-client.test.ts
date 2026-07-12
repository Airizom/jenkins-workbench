import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsPendingInputClient } from "../src/jenkins/client/JenkinsPendingInputClient";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const BUILD_URL = "https://jenkins.example.com/job/demo/15/";

describe("JenkinsPendingInputClient", () => {
  it("preserves submission controls when parameter names collide", async () => {
    let submittedBody: string | undefined;
    const context = createJenkinsClientContext({
      requestVoidWithCrumb: async (_url, body) => {
        submittedBody = typeof body === "string" ? body : undefined;
      }
    });
    const client = new JenkinsPendingInputClient(context);
    const params = new URLSearchParams({
      json: "custom-json",
      inputId: "custom-input-id",
      proceed: "custom-proceed"
    });

    await client.proceedInput(BUILD_URL, "approval", {
      params,
      proceedText: "Approve"
    });

    assert.ok(submittedBody);
    const submitted = new URLSearchParams(submittedBody);
    assert.equal(submitted.get("inputId"), "approval");
    assert.equal(submitted.get("proceed"), "Approve");
    assert.deepEqual(JSON.parse(submitted.get("json") ?? ""), {
      parameter: [
        { name: "json", value: "custom-json" },
        { name: "inputId", value: "custom-input-id" },
        { name: "proceed", value: "custom-proceed" }
      ]
    });
  });
});
