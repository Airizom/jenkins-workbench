import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsPendingInputClient } from "../src/jenkins/client/JenkinsPendingInputClient";
import { JenkinsRequestError } from "../src/jenkins/errors";
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
    const params = [
      { name: "json", value: "custom-json" },
      { name: "inputId", value: "custom-input-id" },
      { name: "proceed", value: "custom-proceed" }
    ];

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

  it("submits multi-value and run parameters in the shapes Jenkins binds", async () => {
    let submittedUrl: string | undefined;
    let submittedBody: string | undefined;
    const context = createJenkinsClientContext({
      requestVoidWithCrumb: async (url, body) => {
        submittedUrl = url;
        submittedBody = typeof body === "string" ? body : undefined;
      }
    });
    const client = new JenkinsPendingInputClient(context);

    await client.proceedInput(BUILD_URL, "approval", {
      params: [
        { name: "REGIONS", value: ["us", "eu"] },
        { name: "UPSTREAM", value: "folder/app#12", runId: "folder/app#12" },
        { name: "NOTES", value: "line one\nline two" }
      ]
    });

    assert.equal(
      submittedUrl,
      "https://jenkins.example.com/job/demo/15/wfapi/inputSubmit?inputId=approval"
    );
    assert.ok(submittedBody);
    const submitted = new URLSearchParams(submittedBody);
    assert.deepEqual(submitted.getAll("REGIONS"), ["us", "eu"]);
    assert.equal(submitted.get("UPSTREAM"), "folder/app#12");
    assert.equal(submitted.get("NOTES"), "line one\nline two");
    assert.equal(submitted.get("proceed"), "Proceed");
    assert.deepEqual(JSON.parse(submitted.get("json") ?? ""), {
      parameter: [
        { name: "REGIONS", value: ["us", "eu"] },
        { name: "UPSTREAM", value: "folder/app#12", runId: "folder/app#12" },
        { name: "NOTES", value: "line one\nline two" }
      ]
    });
  });

  it("uses the generated proceed endpoint when an explicit proceed URL returns 404", async () => {
    const requests: string[] = [];
    const context = createJenkinsClientContext({
      requestVoidWithCrumb: async (url) => {
        requests.push(url);
        if (requests.length === 1) {
          throw new JenkinsRequestError("Not found", 404);
        }
      }
    });
    const client = new JenkinsPendingInputClient(context);

    await client.proceedInput(BUILD_URL, "approval/id", {
      proceedUrl: "input/approval/proceedEmpty"
    });

    assert.deepEqual(requests, [
      "https://jenkins.example.com/job/demo/15/input/approval/proceedEmpty",
      "https://jenkins.example.com/job/demo/15/input/approval%2Fid/proceed"
    ]);
  });
});

it("submits the form required by a parameterless wfapi approval URL", async () => {
  let body: string | Uint8Array | undefined;
  const client = new JenkinsPendingInputClient(
    createJenkinsClientContext({
      requestVoidWithCrumb: async (_url, submitted) => {
        body = submitted;
      }
    })
  );
  await client.proceedInput(BUILD_URL, "approval", {
    proceedUrl: "wfapi/inputSubmit?inputId=approval",
    proceedText: "Approve"
  });
  assert.equal(typeof body, "string");
  const form = new URLSearchParams(body as string);
  assert.equal(form.get("inputId"), "approval");
  assert.equal(form.get("proceed"), "Approve");
  assert.deepEqual(JSON.parse(form.get("json") ?? ""), { parameter: [] });
});
