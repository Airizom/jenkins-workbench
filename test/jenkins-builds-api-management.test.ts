import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsBuildsApi } from "../src/jenkins/client/JenkinsBuildsApi";
import { buildBuildDetailsTree } from "../src/jenkins/client/JenkinsBuildTreeBuilders";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const BUILD_URL = "https://jenkins.example.com/job/demo/15/";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=utf-8";

interface RecordedPost {
  kind: "void" | "raw";
  url: string;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

function createHarness(): { api: JenkinsBuildsApi; posts: RecordedPost[]; gets: string[] } {
  const posts: RecordedPost[] = [];
  const gets: string[] = [];
  const context = createJenkinsClientContext({
    requestJson: async <T>(url: string): Promise<T> => {
      gets.push(url);
      return { number: 15, url: BUILD_URL } as T;
    },
    requestVoidWithCrumb: async (url, body) => {
      posts.push({ kind: "void", url, body });
    },
    requestPostWithCrumbRaw: async (url, body, headers) => {
      posts.push({ kind: "raw", url, body, headers });
      return {};
    }
  });
  return { api: new JenkinsBuildsApi(context), posts, gets };
}

function decodeFormField(body: string | Uint8Array | undefined, field: string): string | null {
  assert.equal(typeof body, "string");
  return new URLSearchParams(body as string).get(field);
}

describe("JenkinsBuildsApi build management", () => {
  it("posts doDelete without a body", async () => {
    const { api, posts } = createHarness();

    await api.deleteBuild("https://jenkins.example.com/job/demo/15");

    assert.deepEqual(posts, [{ kind: "void", url: `${BUILD_URL}doDelete`, body: undefined }]);
  });

  it("posts toggleLogKeep without a body", async () => {
    const { api, posts } = createHarness();

    await api.toggleBuildKeepLog(BUILD_URL);

    assert.deepEqual(posts, [{ kind: "void", url: `${BUILD_URL}toggleLogKeep`, body: undefined }]);
  });

  it("posts a form-encoded description to submitDescription", async () => {
    const { api, posts } = createHarness();
    const description = "Release <b>candidate</b> & notes\nline two = ok ✓";

    await api.submitBuildDescription(BUILD_URL, description);

    assert.equal(posts.length, 1);
    const [post] = posts;
    assert.equal(post.kind, "raw");
    assert.equal(post.url, `${BUILD_URL}submitDescription`);
    assert.equal(post.body, `description=${encodeURIComponent(description)}`);
    assert.equal(decodeFormField(post.body, "description"), description);
    assert.equal(post.headers?.["Content-Type"], FORM_CONTENT_TYPE);
  });

  it("posts the display name and description as a json form field to configSubmit", async () => {
    const { api, posts } = createHarness();
    const displayName = 'Nightly "RC" & more ✓';
    const description = "Keep\nthis + that";

    await api.submitBuildDisplayName(BUILD_URL, displayName, description);

    assert.equal(posts.length, 1);
    const [post] = posts;
    assert.equal(post.kind, "raw");
    assert.equal(post.url, `${BUILD_URL}configSubmit`);
    assert.equal(post.headers?.["Content-Type"], FORM_CONTENT_TYPE);
    assert.match(post.body as string, /^json=/);
    const json = decodeFormField(post.body, "json");
    assert.ok(json);
    assert.deepEqual(JSON.parse(json), { displayName, description });
  });

  it("sends an empty display name so Jenkins resets to the default label", async () => {
    const { api, posts } = createHarness();

    await api.submitBuildDisplayName(BUILD_URL, "", "");

    const json = decodeFormField(posts[0]?.body, "json");
    assert.deepEqual(JSON.parse(json ?? "null"), { displayName: "", description: "" });
  });

  it("requests the management tree for managementOnly build details", async () => {
    const { api, gets } = createHarness();

    await api.getBuildDetails(BUILD_URL, { managementOnly: true });

    assert.equal(gets.length, 1);
    const tree = new URL(gets[0]).searchParams.get("tree");
    assert.equal(tree, "number,url,building,keepLog,displayName,description");
    assert.equal(buildBuildDetailsTree({ managementOnly: true }), tree);
  });
});
