import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { encodeDeepLinkPayload } from "../src/extension/UriQueryParams";
import {
  formatWorkbenchDeepLink,
  JENKINS_WORKBENCH_EXTENSION_ID,
  parseWorkbenchDeepLink,
  parseWorkbenchDeepLinkText,
  type WorkbenchDeepLinkResult
} from "../src/extension/WorkbenchDeepLinks";

function parseOk(input: string): Extract<WorkbenchDeepLinkResult, { ok: true }> {
  const result = parseWorkbenchDeepLinkText(input);
  assert.equal(result?.ok, true, JSON.stringify(result));
  return result as Extract<WorkbenchDeepLinkResult, { ok: true }>;
}

function payloadLink(
  scheme: string,
  action: string,
  fields: Parameters<typeof encodeDeepLinkPayload>[0]
): string {
  return `${scheme}://airizom.jenkins-workbench/${action}?payload=${encodeDeepLinkPayload(fields)}`;
}

describe("parseWorkbenchDeepLinkText", () => {
  it.each([
    "123",
    "not a url",
    "https://ci.example/job/a/1/",
    "vscode://other.extension/build?url=https://ci.example/job/a/1/"
  ])("ignores %j, which is not a Workbench link", (input) => {
    assert.equal(parseWorkbenchDeepLinkText(input), undefined);
  });

  it.each([
    "vscode://airizom.jenkins-workbench/settings?url=https://ci.example/job/a/1/",
    "vscode://airizom.jenkins-workbench/build",
    "vscode://airizom.jenkins-workbench/build?url=",
    "vscode://airizom.jenkins-workbench/build?url=ftp://ci.example/job/a/1/",
    "vscode://airizom.jenkins-workbench/build?url=not-a-url",
    "vscode://airizom.jenkins-workbench/build?payload=***",
    "vscode://airizom.jenkins-workbench/build?payload=abc&nodeId=1"
  ])("rejects %j with a message", (input) => {
    const result = parseWorkbenchDeepLinkText(input);
    assert.equal(result?.ok, false);
    assert.ok((result as { message: string }).message.length > 0);
  });

  it.each(["vscode", "vscode-insiders", "cursor", "windsurf"])(
    "decodes %s:// payload build links with node selection",
    (scheme) => {
      const link = payloadLink(scheme, "build", {
        url: "https://ci.example/job/app/12/",
        nodeId: "17",
        nodeKind: "STEP",
        nodeName: "build & test"
      });
      const result = parseOk(link);
      assert.equal(result.url.toString(), "https://ci.example/job/app/12/");
      assert.equal(result.action, "build");
      assert.deepEqual(result.nodeSelection, { kind: "step", nodeId: "17", name: "build & test" });
    }
  );

  it("decodes payload job links without node selection", () => {
    const link = payloadLink("vscode", "job", { url: "https://ci.example/job/app/", nodeId: "3" });
    const result = parseOk(link);
    assert.equal(result.url.toString(), "https://ci.example/job/app/");
    assert.equal(result.action, "job");
    assert.equal(result.nodeSelection, undefined);
  });

  it("matches the Workbench authority and action case-insensitively", () => {
    const result = parseOk(
      "VSCODE://Airizom.Jenkins-Workbench/Build/?url=https://ci.example/job/app/3/"
    );
    assert.equal(result.action, "build");
    assert.equal(result.url.toString(), "https://ci.example/job/app/3/");
  });

  it("defaults non-step node kinds to stage", () => {
    const link = payloadLink("vscode", "build", {
      url: "https://ci.example/job/app/12/",
      nodeId: "9"
    });
    assert.deepEqual(parseOk(link).nodeSelection, {
      kind: "stage",
      nodeId: "9",
      name: undefined
    });
  });

  it("decodes legacy ?url= links once, keeping encoded multibranch names", () => {
    const target = "https://ci.example/job/repo/job/feature%2Fbranch/4/";
    const link =
      "cursor://airizom.jenkins-workbench/build?nodeId=8&nodeKind=stage&nodeName=Unit%20tests" +
      `&url=${encodeURIComponent(target)}`;
    const result = parseOk(link);
    assert.equal(result.url.toString(), target);
    assert.equal(result.action, "build");
    assert.deepEqual(result.nodeSelection, { kind: "stage", nodeId: "8", name: "Unit tests" });
  });

  it("accepts legacy links whose url value is not percent-encoded", () => {
    const result = parseOk(
      "vscode://airizom.jenkins-workbench/job?url=https://ci.example/job/folder/job/app/"
    );
    assert.equal(result.url.toString(), "https://ci.example/job/folder/job/app/");
    assert.equal(result.action, "job");
  });

  it("leaves malformed percent sequences in legacy links untouched", () => {
    const result = parseOk(
      "vscode://airizom.jenkins-workbench/build?url=https://ci.example/job/a%E0%A4/1/"
    );
    assert.equal(result.url.toString(), "https://ci.example/job/a%E0%A4/1/");
  });
});

describe("parseWorkbenchDeepLink", () => {
  it("reports the URI handler's messages for each failure", () => {
    assert.deepEqual(parseWorkbenchDeepLink("settings", "url=https://ci.example/"), {
      ok: false,
      message: "Unsupported Jenkins Workbench link. Use /build?url= or /job?url=."
    });
    assert.deepEqual(parseWorkbenchDeepLink("build", "nodeId=1"), {
      ok: false,
      message: "Missing required 'url' query parameter."
    });
    assert.deepEqual(parseWorkbenchDeepLink("job", "url=ftp://ci.example/"), {
      ok: false,
      message: "Invalid Jenkins URL. Expected an http or https URL."
    });
    assert.deepEqual(parseWorkbenchDeepLink("build", "payload=***"), {
      ok: false,
      message: "Invalid Jenkins Workbench link payload."
    });
  });
});

describe("formatWorkbenchDeepLink", () => {
  it("formats links that parse back to the same target", () => {
    const node = { kind: "step" as const, nodeId: "4", name: "sh" };
    const link = formatWorkbenchDeepLink(
      "vscode-insiders",
      "build",
      "https://ci.example/job/a/1/",
      node
    );
    assert.ok(
      link?.startsWith(`vscode-insiders://${JENKINS_WORKBENCH_EXTENSION_ID}/build?payload=`)
    );
    const parsed = parseOk(link ?? "");
    assert.equal(parsed.url.toString(), "https://ci.example/job/a/1/");
    assert.deepEqual(parsed.nodeSelection, node);
  });

  it("drops node selections from job links and refuses oversized payloads", () => {
    const job = formatWorkbenchDeepLink("vscode", "job", "https://ci.example/job/a/", {
      kind: "stage",
      nodeId: "1"
    });
    assert.equal(parseOk(job ?? "").nodeSelection, undefined);
    assert.equal(
      formatWorkbenchDeepLink("vscode", "build", `https://ci.example/${"a".repeat(20_000)}`),
      undefined
    );
  });
});
