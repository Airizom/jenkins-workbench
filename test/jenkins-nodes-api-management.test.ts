import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClientContext } from "../src/jenkins/client/JenkinsClientContext";
import { JenkinsNodesApi } from "../src/jenkins/client/JenkinsNodesApi";

function createApi() {
  const requestText = vi.fn(async (_url: string) => "<slave/>");
  const requestPostWithCrumbRaw = vi.fn(
    async (_url: string, _body: string | Uint8Array, _headers?: Record<string, string>) => ({})
  );
  const requestVoidWithCrumb = vi.fn(async (_url: string, _body?: string | Uint8Array) => {});
  const context = {
    baseUrl: "https://example.com/jenkins/",
    requestText,
    requestPostWithCrumbRaw,
    requestVoidWithCrumb
  } as unknown as JenkinsClientContext;
  return {
    api: new JenkinsNodesApi(context),
    requestText,
    requestPostWithCrumbRaw,
    requestVoidWithCrumb
  };
}

describe("node management API", () => {
  it("uses config.xml and XML content type with crumb-aware writes", async () => {
    const { api, requestText, requestPostWithCrumbRaw } = createApi();
    const url = "https://example.com/jenkins/computer/agent%20one/";
    assert.equal(await api.getNodeConfigXml(url), "<slave/>");
    await api.updateNodeConfigXml(url, "<slave><label>linux</label></slave>");
    assert.deepEqual(requestText.mock.calls, [[`${url}config.xml`]]);
    assert.deepEqual(requestPostWithCrumbRaw.mock.calls, [
      [
        `${url}config.xml`,
        "<slave><label>linux</label></slave>",
        { "Content-Type": "application/xml; charset=utf-8" }
      ]
    ]);
  });

  it("encodes disconnect reasons and uses the deletion endpoint", async () => {
    const { api, requestVoidWithCrumb } = createApi();
    const url = "https://example.com/jenkins/computer/agent/";
    await api.disconnectNodeAgent(url, "  reason & next  ");
    await api.deleteNode(url);
    assert.deepEqual(requestVoidWithCrumb.mock.calls, [
      [`${url}doDisconnect`, "offlineMessage=reason+%26+next"],
      [`${url}doDelete`]
    ]);
  });

  it("creates escaped names under Jenkins context and copies server-side", async () => {
    const { api, requestPostWithCrumbRaw, requestVoidWithCrumb } = createApi();
    await api.createNode("agent é", "<slave/>");
    await api.copyNode("source é", "new node");
    assert.equal(
      requestPostWithCrumbRaw.mock.calls[0][0],
      "https://example.com/jenkins/computer/createItem?name=agent+%C3%A9"
    );
    assert.deepEqual(requestVoidWithCrumb.mock.calls, [
      [
        "https://example.com/jenkins/computer/createItem",
        "name=new+node&mode=copy&from=source+%C3%A9"
      ]
    ]);
  });

  it("propagates failed writes instead of treating them as success", async () => {
    const { api, requestVoidWithCrumb } = createApi();
    requestVoidWithCrumb.mockRejectedValueOnce(new Error("forbidden"));
    await assert.rejects(
      api.deleteNode("https://example.com/jenkins/computer/agent/"),
      /forbidden/
    );
  });
});
