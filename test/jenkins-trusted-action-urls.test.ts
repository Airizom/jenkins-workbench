import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsBuildsApi } from "../src/jenkins/client/JenkinsBuildsApi";
import { JenkinsPendingInputClient } from "../src/jenkins/client/JenkinsPendingInputClient";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const BUILD_URL = "https://jenkins.example.com/job/demo/15/";

describe("server-provided Jenkins action URLs", () => {
  it("rejects a cross-origin pending-input URL before making the action request", async () => {
    const requests: string[] = [];
    const context = createJenkinsClientContext({
      requestVoidWithCrumb: async (url) => {
        requests.push(url);
      }
    });
    const client = new JenkinsPendingInputClient(context);

    await assert.rejects(
      client.proceedInput(BUILD_URL, "approval", {
        proceedUrl: "https://attacker.example/proceed"
      }),
      (error: unknown) =>
        error instanceof JenkinsRequestError && error.message.includes("untrusted origin")
    );
    assert.deepEqual(requests, []);
  });

  it("allows relative and same-origin absolute pending-input URLs", async () => {
    const requests: string[] = [];
    const context = createJenkinsClientContext({
      requestVoidWithCrumb: async (url) => {
        requests.push(url);
      }
    });
    const client = new JenkinsPendingInputClient(context);

    await client.proceedInput(BUILD_URL, "approval", { proceedUrl: "input/approval/proceed" });
    await client.abortInput(
      BUILD_URL,
      "approval",
      "https://jenkins.example.com/job/demo/15/input/approval/abort"
    );

    assert.deepEqual(requests, [
      "https://jenkins.example.com/job/demo/15/input/approval/proceed",
      "https://jenkins.example.com/job/demo/15/input/approval/abort"
    ]);
  });

  it("rejects a cross-origin flow-node console URL before requesting console text", async () => {
    const textRequests: string[] = [];
    const context = createJenkinsClientContext({
      requestJson: async <T>(): Promise<T> =>
        ({ consoleUrl: "https://attacker.example/console/" }) as T,
      requestTextWithHeaders: async (url) => {
        textRequests.push(url);
        return { text: "", headers: {} };
      }
    });
    const api = new JenkinsBuildsApi(context);

    await assert.rejects(
      api.getFlowNodeLogHtmlProgressive(BUILD_URL, "node-1", 0),
      (error: unknown) =>
        error instanceof JenkinsRequestError && error.message.includes("untrusted origin")
    );
    assert.deepEqual(textRequests, []);
  });

  it("resolves a same-origin relative flow-node console URL", async () => {
    const textRequests: string[] = [];
    const context = createJenkinsClientContext({
      requestJson: async <T>(): Promise<T> => ({ consoleUrl: "console/" }) as T,
      requestTextWithHeaders: async (url) => {
        textRequests.push(url);
        return { text: "", headers: {} };
      }
    });
    const api = new JenkinsBuildsApi(context);

    await api.getFlowNodeLogHtmlProgressive(BUILD_URL, "node-1", 4);

    assert.deepEqual(textRequests, [
      "https://jenkins.example.com/job/demo/15/console/logText/progressiveHtml?start=4"
    ]);
  });
});
