import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JenkinsBuildsApi } from "../src/jenkins/client/JenkinsBuildsApi";
import type { JenkinsClientContext } from "../src/jenkins/client/JenkinsClientContext";

interface ContextHarness {
  context: JenkinsClientContext;
  requestedUrls: string[];
}

function createContextHarness(): ContextHarness {
  const requestedUrls: string[] = [];
  const context: JenkinsClientContext = {
    baseUrl: "https://jenkins.example.com/",
    requestJson: async <T>(url: string): Promise<T> => {
      requestedUrls.push(url);
      return { builds: [] } as T;
    },
    requestHeaders: async () => ({}),
    requestText: async () => "",
    requestTextWithHeaders: async () => ({ text: "", headers: {} }),
    requestBufferWithHeaders: async () => ({ data: new Uint8Array(), headers: {} }),
    requestStream: async () => {
      throw new Error("not implemented");
    },
    requestVoidWithCrumb: async () => undefined,
    requestPostWithCrumb: async () => ({}),
    requestPostWithCrumbRaw: async () => ({}),
    requestPostTextWithCrumbRaw: async () => ""
  };
  return { context, requestedUrls };
}

function getTreeParameter(url: string): string {
  const tree = new URL(url).searchParams.get("tree");
  assert.ok(tree, `expected a tree parameter on ${url}`);
  return tree;
}

describe("JenkinsBuildsApi getBuilds tree range", () => {
  it("requests {0,limit} so the exclusive Stapler range returns `limit` builds", async () => {
    const { context, requestedUrls } = createContextHarness();
    const api = new JenkinsBuildsApi(context);

    await api.getBuilds("https://jenkins.example.com/job/demo/", 20);

    assert.equal(requestedUrls.length, 1);
    assert.match(getTreeParameter(requestedUrls[0]), /\{0,20\}$/);
  });

  it("requests {0,1} for limit=1 instead of the empty range {0,0}", async () => {
    const { context, requestedUrls } = createContextHarness();
    const api = new JenkinsBuildsApi(context);

    await api.getBuilds("https://jenkins.example.com/job/demo/", 1);

    assert.equal(requestedUrls.length, 1);
    assert.match(getTreeParameter(requestedUrls[0]), /\{0,1\}$/);
  });

  it("uses the default limit of 20 when none is provided", async () => {
    const { context, requestedUrls } = createContextHarness();
    const api = new JenkinsBuildsApi(context);

    await api.getBuilds("https://jenkins.example.com/job/demo/");

    assert.equal(requestedUrls.length, 1);
    assert.match(getTreeParameter(requestedUrls[0]), /\{0,20\}$/);
  });

  it("returns an empty list without a request when limit is zero or negative", async () => {
    const { context, requestedUrls } = createContextHarness();
    const api = new JenkinsBuildsApi(context);

    assert.deepEqual(await api.getBuilds("https://jenkins.example.com/job/demo/", 0), []);
    assert.deepEqual(await api.getBuilds("https://jenkins.example.com/job/demo/", -5), []);
    assert.equal(requestedUrls.length, 0);
  });
});
