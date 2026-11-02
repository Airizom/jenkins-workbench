import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClientContext } from "../src/jenkins/client/JenkinsClientContext";
import { JenkinsJobsApi } from "../src/jenkins/client/JenkinsJobsApi";
import { JenkinsDuplicateItemError, JenkinsRequestError } from "../src/jenkins/errors";

function createApi(location?: string) {
  const requestPostWithCrumb = vi.fn(async (_url: string, _body?: string | Uint8Array) => ({
    location
  }));
  const requestPostWithCrumbRaw = vi.fn(
    async (_url: string, _body: string | Uint8Array, _headers?: Record<string, string>) => ({
      location
    })
  );
  const context = {
    baseUrl: "https://jenkins.example/",
    requestPostWithCrumb,
    requestPostWithCrumbRaw
  } as unknown as JenkinsClientContext;
  return { api: new JenkinsJobsApi(context), requestPostWithCrumb, requestPostWithCrumbRaw };
}

const parentUrl = "https://jenkins.example/job/team/";

describe("JenkinsJobsApi item creation", () => {
  it("creates a folder with the Folder mode", async () => {
    const { api, requestPostWithCrumb } = createApi();

    const result = await api.createItem("folder", parentUrl, "new folder");

    assert.deepEqual(requestPostWithCrumb.mock.calls[0], [
      `${parentUrl}createItem?name=new+folder&mode=com.cloudbees.hudson.plugins.folder.Folder`,
      ""
    ]);
    assert.deepEqual(result, { newUrl: `${parentUrl}job/new%20folder/` });
  });

  it("maps the configure redirect Jenkins returns to the item URL", async () => {
    const { api } = createApi("/job/team/job/demo/configure");

    const result = await api.createItem("pipeline", parentUrl, "demo");

    assert.deepEqual(result, { newUrl: "https://jenkins.example/job/team/job/demo/" });
  });

  it("posts XML to createItem with the name and an XML content type", async () => {
    const { api, requestPostWithCrumbRaw } = createApi();

    const result = await api.createItemFromXml(parentUrl, "mb é", "<project/>");

    assert.deepEqual(requestPostWithCrumbRaw.mock.calls[0], [
      `${parentUrl}createItem?name=mb+%C3%A9`,
      "<project/>",
      { "Content-Type": "application/xml; charset=utf-8" }
    ]);
    assert.deepEqual(result, { newUrl: `${parentUrl}job/mb%20%C3%A9/` });
  });

  it("uses the Location header after an XML create when Jenkins sends one", async () => {
    const { api } = createApi("https://jenkins.example/job/team/job/mb/");

    const result = await api.createItemFromXml(parentUrl, "mb", "<project/>");

    assert.deepEqual(result, { newUrl: "https://jenkins.example/job/team/job/mb/" });
  });

  it("creates a multibranch pipeline from generated XML", async () => {
    const { api, requestPostWithCrumbRaw } = createApi();

    await api.createMultibranchPipeline(parentUrl, "mb", {
      repositoryUrl: "https://git.example/demo.git",
      scriptPath: "Jenkinsfile"
    });

    const [url, body] = requestPostWithCrumbRaw.mock.calls[0];
    assert.equal(url, `${parentUrl}createItem?name=mb`);
    assert.match(String(body), /WorkflowMultiBranchProject/);
    assert.match(String(body), /<remote>https:\/\/git\.example\/demo\.git<\/remote>/);
  });

  it("explains a taken name from the Jenkins response body or X-Error header", async () => {
    const { api, requestPostWithCrumb, requestPostWithCrumbRaw } = createApi();
    requestPostWithCrumb.mockRejectedValueOnce(
      new JenkinsRequestError(
        "Jenkins API request failed (400 Bad Request)",
        400,
        "<html><p>A job already exists with the name ‘demo’</p></html>"
      )
    );
    requestPostWithCrumbRaw.mockRejectedValueOnce(
      new JenkinsRequestError("Jenkins API request failed (500 Server Error)", 500, "", {
        "x-error": "Team already contains an item 'mb'"
      })
    );

    await assert.rejects(
      api.createItem("folder", parentUrl, "demo"),
      (error: unknown) =>
        error instanceof JenkinsDuplicateItemError &&
        error.statusCode === 400 &&
        error.message === 'An item named "demo" already exists in this location.'
    );
    await assert.rejects(
      api.createItemFromXml(parentUrl, "mb", "<project/>"),
      /An item named "mb" already exists in this location\./
    );
  });

  it("leaves other create failures unchanged", async () => {
    const { api, requestPostWithCrumbRaw } = createApi();
    const original = new JenkinsRequestError(
      "Jenkins API request failed (500 Server Error)",
      500,
      "No such class jenkins.plugins.git.GitSCMSource"
    );
    requestPostWithCrumbRaw.mockRejectedValueOnce(original);

    await assert.rejects(
      api.createItemFromXml(parentUrl, "mb", "<project/>"),
      (error) => error === original
    );
  });

  it("classifies items by their Jenkins class", () => {
    const { api } = createApi();
    const classify = (className?: string) =>
      api.classifyJob({ name: "x", url: parentUrl, _class: className } as never);

    assert.equal(classify(undefined), "unknown");
    assert.equal(classify("com.cloudbees.hudson.plugins.folder.Folder"), "folder");
    assert.equal(classify("jenkins.branch.OrganizationFolder"), "folder");
    assert.equal(
      classify("org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject"),
      "multibranch"
    );
    assert.equal(classify("org.jenkinsci.plugins.workflow.job.WorkflowJob"), "pipeline");
    assert.equal(classify("hudson.model.FreeStyleProject"), "job");
    assert.equal(classify("hudson.matrix.MatrixProject"), "job");
    assert.equal(classify("   "), "unknown");
  });
});
