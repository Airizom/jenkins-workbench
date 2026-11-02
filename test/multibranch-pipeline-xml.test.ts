import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildMultibranchPipelineXml } from "../src/jenkins/MultibranchPipelineXml";

const fixedId = () => "source-id";

describe("buildMultibranchPipelineXml", () => {
  it("builds a multibranch project with one Git branch source", () => {
    const xml = buildMultibranchPipelineXml(
      {
        repositoryUrl: "https://git.example/demo.git",
        credentialsId: "git-creds",
        scriptPath: "ci/Jenkinsfile"
      },
      fixedId
    );

    assert.match(xml, /^<\?xml version='1\.1' encoding='UTF-8'\?>\n/);
    assert.match(
      xml,
      /<org\.jenkinsci\.plugins\.workflow\.multibranch\.WorkflowMultiBranchProject>/
    );
    assert.match(
      xml,
      /<sources class="jenkins\.branch\.MultiBranchProject\$BranchSourceList">\s*<data>\s*<jenkins\.branch\.BranchSource>\s*<source class="jenkins\.plugins\.git\.GitSCMSource">/
    );
    assert.match(xml, /<id>source-id<\/id>/);
    assert.match(xml, /<remote>https:\/\/git\.example\/demo\.git<\/remote>/);
    assert.match(xml, /<credentialsId>git-creds<\/credentialsId>/);
    assert.match(
      xml,
      /<traits>\s*<jenkins\.plugins\.git\.traits\.BranchDiscoveryTrait\/>\s*<\/traits>/
    );
    assert.match(
      xml,
      /<factory class="org\.jenkinsci\.plugins\.workflow\.multibranch\.WorkflowBranchProjectFactory">\s*<scriptPath>ci\/Jenkinsfile<\/scriptPath>\s*<\/factory>/
    );
  });

  it("omits credentials when none or only whitespace is given", () => {
    for (const credentialsId of [undefined, "", "   "]) {
      const xml = buildMultibranchPipelineXml(
        { repositoryUrl: "https://git.example/demo.git", credentialsId, scriptPath: "Jenkinsfile" },
        fixedId
      );
      assert.doesNotMatch(xml, /credentialsId/);
    }
  });

  it("escapes every user-supplied value", () => {
    const xml = buildMultibranchPipelineXml(
      {
        repositoryUrl: "https://git.example/a?x=1&y=<2>",
        credentialsId: `id"'&`,
        scriptPath: "dir/<Jenkinsfile>"
      },
      () => "id&1"
    );

    assert.match(xml, /<remote>https:\/\/git\.example\/a\?x=1&amp;y=&lt;2&gt;<\/remote>/);
    assert.match(xml, /<credentialsId>id&quot;&apos;&amp;<\/credentialsId>/);
    assert.match(xml, /<scriptPath>dir\/&lt;Jenkinsfile&gt;<\/scriptPath>/);
    assert.match(xml, /<id>id&amp;1<\/id>/);
  });

  it("generates a distinct source id by default", () => {
    const options = { repositoryUrl: "https://git.example/demo.git", scriptPath: "Jenkinsfile" };
    const first = /<id>([^<]+)<\/id>/.exec(buildMultibranchPipelineXml(options))?.[1];
    const second = /<id>([^<]+)<\/id>/.exec(buildMultibranchPipelineXml(options))?.[1];
    assert.ok(first);
    assert.notEqual(first, second);
  });

  it("rejects a blank repository URL or script path", () => {
    assert.throws(
      () => buildMultibranchPipelineXml({ repositoryUrl: " ", scriptPath: "Jenkinsfile" }),
      /repository URL/
    );
    assert.throws(
      () => buildMultibranchPipelineXml({ repositoryUrl: "https://git.example/r", scriptPath: "" }),
      /script path/
    );
  });
});
