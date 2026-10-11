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

  it("rejects unsupported protocols and embedded credentials in pending-input URLs", async () => {
    const requests: string[] = [];
    const context = createJenkinsClientContext({
      requestVoidWithCrumb: async (url) => {
        requests.push(url);
      }
    });
    const client = new JenkinsPendingInputClient(context);

    await assert.rejects(
      client.proceedInput(BUILD_URL, "approval", { proceedUrl: "file:///tmp/action" }),
      /protocol/i
    );
    await assert.rejects(
      client.proceedInput(BUILD_URL, "approval", {
        proceedUrl: "https://user:secret@jenkins.example.com/job/demo/15/input/approval/proceed"
      }),
      /embedded credentials/i
    );
    assert.deepEqual(requests, []);
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

  it("throws 404 when the flow-node log omits its console URL", async () => {
    const textRequests: string[] = [];
    const context = createJenkinsClientContext({
      requestJson: async <T>(): Promise<T> => ({ nodeId: "node-1" }) as T,
      requestTextWithHeaders: async (url) => {
        textRequests.push(url);
        return { text: "", headers: {} };
      }
    });
    const api = new JenkinsBuildsApi(context);

    await assert.rejects(
      api.getFlowNodeLogHtmlProgressive(BUILD_URL, "node-1", 0),
      (error: unknown) => error instanceof JenkinsRequestError && error.statusCode === 404
    );
    assert.deepEqual(textRequests, []);
  });

  it("resolves a relative flow-node console URL and preserves progressive HTML state", async () => {
    const textRequests: string[] = [];
    const context = createJenkinsClientContext({
      requestJson: async <T>(): Promise<T> => ({ consoleUrl: "console/" }) as T,
      requestTextWithHeaders: async (url, options) => {
        textRequests.push(url);
        assert.deepEqual(options?.headers, { "X-ConsoleAnnotator": "previous" });
        return {
          text: "<span>log</span>",
          headers: { "x-text-size": "12", "x-more-data": "true", "x-console-annotator": "next" }
        };
      }
    });
    const api = new JenkinsBuildsApi(context);

    const result = await api.getFlowNodeLogHtmlProgressive(BUILD_URL, "node-1", 4.9, "previous");

    assert.deepEqual(textRequests, [
      "https://jenkins.example.com/job/demo/15/console/logText/progressiveHtml?start=4"
    ]);
    assert.deepEqual(result, {
      html: "<span>log</span>",
      textSize: 12,
      textSizeKnown: true,
      moreData: true,
      annotator: "next"
    });
  });
});
