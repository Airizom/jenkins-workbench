import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it, vi } from "vitest";
import { parseDeepLinkPayload } from "../src/extension/UriQueryParams";

const writeText = vi.fn(async (_text: string) => undefined);
const setStatusBarMessage = vi.fn();
const showErrorMessage = vi.fn(async () => undefined);
const showQuickPick = vi.fn();

vi.doMock("vscode", () => ({
  env: { uriScheme: "vscode-insiders", clipboard: { writeText } },
  window: { setStatusBarMessage, showErrorMessage, showQuickPick }
}));

const { JENKINS_WORKBENCH_EXTENSION_ID } = await import("../src/extension/WorkbenchDeepLinks");
const {
  copyJenkinsLink,
  copyLink,
  copyWorkbenchLink,
  jenkinsLink,
  markdownLink,
  pickAndCopyBuildLink,
  workbenchLink
} = await import("../src/services/links/BuildShareLinks");

const environmentUrl = "https://jenkins.example/";
const buildUrl = "https://jenkins.example/job/folder/job/app/12/";
const stage = { kind: "stage" as const, nodeId: "42", name: "Build" };

function decodeWorkbenchLink(link: string | undefined): {
  prefix: string;
  fields: Record<string, string>;
} {
  assert.ok(link);
  const [prefix, query] = link.split("?");
  const fields = parseDeepLinkPayload(query);
  assert.ok(fields, `undecodable payload in ${link}`);
  return { prefix, fields: Object.fromEntries(fields) };
}

beforeEach(() => {
  writeText.mockClear();
  setStatusBarMessage.mockClear();
  showErrorMessage.mockClear();
  showQuickPick.mockReset();
});

describe("BuildShareLinks", () => {
  it("uses the publisher.name extension id from package.json", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(JENKINS_WORKBENCH_EXTENSION_ID, `${manifest.publisher}.${manifest.name}`);
  });

  it("strips credentials from Jenkins links", () => {
    assert.equal(
      jenkinsLink("https://user:token@jenkins.example/job/app/1/"),
      "https://jenkins.example/job/app/1/"
    );
    assert.equal(jenkinsLink(buildUrl), buildUrl);
  });

  it("builds a Workbench link for the running VS Code scheme with the node selection", () => {
    const { prefix, fields } = decodeWorkbenchLink(
      workbenchLink("build", "https://user:token@jenkins.example/job/folder/job/app/12/", stage)
    );
    assert.equal(prefix, "vscode-insiders://airizom.jenkins-workbench/build");
    assert.deepEqual(fields, { url: buildUrl, nodeId: "42", nodeKind: "stage", nodeName: "Build" });
  });

  it("omits node fields for job links and for builds without a selection", () => {
    const job = decodeWorkbenchLink(
      workbenchLink("job", "https://jenkins.example/job/app/", stage)
    );
    assert.equal(job.prefix, "vscode-insiders://airizom.jenkins-workbench/job");
    assert.deepEqual(job.fields, { url: "https://jenkins.example/job/app/" });
    assert.deepEqual(decodeWorkbenchLink(workbenchLink("build", buildUrl)).fields, {
      url: buildUrl
    });
  });

  it("returns undefined when the payload cannot be encoded", () => {
    assert.equal(workbenchLink("build", ""), undefined);
    assert.equal(
      workbenchLink("build", `https://jenkins.example/${"x".repeat(20_000)}`),
      undefined
    );
  });

  it("formats Markdown links with build and job labels", () => {
    const build = markdownLink({ kind: "build", url: buildUrl, environmentUrl });
    assert.ok(build);
    assert.match(
      build,
      /^\[folder\/app #12\]\(https:\/\/jenkins\.example\/job\/folder\/job\/app\/12\/\) · \[Open in VS Code\]\(vscode-insiders:\/\/airizom\.jenkins-workbench\/build\?payload=[A-Za-z0-9_-]+\)$/
    );

    const job = markdownLink({
      kind: "job",
      url: "https://jenkins.example/job/folder/job/app/",
      environmentUrl
    });
    assert.ok(job?.startsWith("[folder/app](https://jenkins.example/job/folder/job/app/) · "));
    assert.match(job ?? "", /\/job\?payload=/);
  });

  it("escapes brackets in labels and parentheses in the Jenkins URL", () => {
    const url = "https://jenkins.example/job/app%20%5Bv2%5D/job/(beta)/3/";
    const markdown = markdownLink({ kind: "build", url, environmentUrl });
    assert.ok(markdown);
    assert.ok(markdown.startsWith("[app \\[v2\\]/(beta) #3]("), markdown);
    assert.ok(markdown.includes("(https://jenkins.example/job/app%20%5Bv2%5D/job/%28beta%29/3/)"));
  });

  it("copies text to the clipboard and confirms in the status bar", async () => {
    await copyLink("https://jenkins.example/", "Jenkins link");
    assert.deepEqual(writeText.mock.calls, [["https://jenkins.example/"]]);
    assert.deepEqual(setStatusBarMessage.mock.calls, [["$(check) Copied Jenkins link", 3000]]);
  });

  it("copies Jenkins and Workbench links and reports unbuildable Workbench links", async () => {
    await copyJenkinsLink({ kind: "build", url: "https://u:p@jenkins.example/job/app/1/" });
    await copyWorkbenchLink({ kind: "build", url: buildUrl, node: stage });
    assert.equal(writeText.mock.calls[0][0], "https://jenkins.example/job/app/1/");
    assert.equal(decodeWorkbenchLink(writeText.mock.calls[1][0]).fields.nodeId, "42");

    await copyWorkbenchLink({ kind: "build", url: "" });
    assert.equal(writeText.mock.calls.length, 2);
    assert.equal(showErrorMessage.mock.calls.length, 1);
  });

  it("offers Jenkins, Workbench, and Markdown links and copies the chosen one", async () => {
    showQuickPick.mockImplementation(async (items: Array<{ label: string }>) => items[2]);
    await pickAndCopyBuildLink({ kind: "build", url: buildUrl, environmentUrl, node: stage });

    const [items] = showQuickPick.mock.calls[0] as [
      Array<{ label: string; description?: string; detail?: string }>
    ];
    assert.deepEqual(
      items.map((item) => item.label),
      ["Copy Jenkins Link", "Copy Workbench Link", "Copy Markdown Link"]
    );
    // The node applies only to Workbench and Markdown links.
    assert.equal(items[0].detail, buildUrl);
    assert.match(items[1].description ?? "", /Opens stage "Build"/);
    assert.equal(decodeWorkbenchLink(items[1].detail).fields.nodeId, "42");
    assert.equal(writeText.mock.calls[0][0], items[2].detail);
    assert.deepEqual(setStatusBarMessage.mock.calls, [["$(check) Copied Markdown link", 3000]]);
  });

  it("copies nothing when the picker is dismissed", async () => {
    showQuickPick.mockResolvedValue(undefined);
    await pickAndCopyBuildLink({ kind: "build", url: buildUrl });
    assert.equal(writeText.mock.calls.length, 0);
    assert.equal(setStatusBarMessage.mock.calls.length, 0);
  });
});
