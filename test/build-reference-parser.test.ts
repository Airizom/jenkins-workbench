import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  type BuildReferenceInput,
  classifyBuildReference,
  formatBuildLabel,
  type ResolvedBuildReference,
  resolveBuildReferenceUrl
} from "../src/jenkins/BuildReferenceParser";
import { JENKINS_BUILD_PERMALINKS } from "../src/jenkins/types";

const ENV = "https://ci.example/";
const CONTEXT_ENV = "https://ci.example/jenkins/";

function classifyUrl(input: string): Extract<BuildReferenceInput, { kind: "url" }> {
  const result = classifyBuildReference(input);
  assert.equal(result.kind, "url", JSON.stringify(result));
  return result as Extract<BuildReferenceInput, { kind: "url" }>;
}

function resolve(input: string, environmentUrl = ENV): ResolvedBuildReference {
  return resolveBuildReferenceUrl(classifyUrl(input).url, environmentUrl);
}

function expectBuild(jobUrl: string, buildNumber: number): ResolvedBuildReference {
  return { kind: "build", buildUrl: `${jobUrl}${buildNumber}/`, jobUrl, buildNumber };
}

describe("classifyBuildReference", () => {
  it.each([
    ["123", 123],
    [" #123 ", 123],
    ["#7", 7],
    ["# 42", 42],
    ["007", 7]
  ])("classifies %j as build number %d", (input, buildNumber) => {
    assert.deepEqual(classifyBuildReference(input), { kind: "number", buildNumber });
  });

  it.each(["0", "#0", "-5", "#-5", "+5", "1.5", "99999999999999999999"])(
    "rejects invalid build number %j",
    (input) => {
      const result = classifyBuildReference(input);
      assert.equal(result.kind, "invalid");
      assert.match((result as { message: string }).message, /positive whole numbers/);
    }
  );

  it.each([
    "",
    "   ",
    "#",
    "abc",
    "ci.example/job/a/1/",
    "ftp://ci.example/job/a/1/",
    "file:///tmp/job/a/1/",
    "vscode://airizom.jenkins-workbench/build?url=https://ci.example/job/a/1/"
  ])("rejects %j with a message", (input) => {
    const result = classifyBuildReference(input);
    assert.equal(result.kind, "invalid");
    assert.ok((result as { message: string }).message.length > 0);
  });

  it("classifies http(s) URLs and strips embedded credentials", () => {
    const result = classifyUrl(" https://user:secret@ci.example/job/a/1/console ");
    assert.equal(result.url.toString(), "https://ci.example/job/a/1/console");
    assert.equal(classifyUrl("http://ci.example:8080/job/a/").url.port, "8080");
  });
});

describe("resolveBuildReferenceUrl", () => {
  it.each([
    "",
    "console",
    "consoleFull",
    "consoleText",
    "display/redirect",
    "testReport/pkg/Class/test/",
    "artifact/a/b.txt",
    "pipeline-graph/",
    "pipeline-overview/",
    "pipeline-console/",
    "flowGraphTable/",
    "execution/node/5/",
    "changes",
    "parameters",
    "replay",
    "restart",
    "api/json",
    "console?start=0#footer",
    "?x=1",
    "#anchor"
  ])("resolves build sub-path %j to the build", (suffix) => {
    assert.deepEqual(
      resolve(`https://ci.example/job/folder/job/app/42/${suffix}`),
      expectBuild("https://ci.example/job/folder/job/app/", 42)
    );
  });

  it("accepts a build URL without a trailing slash", () => {
    assert.deepEqual(
      resolve("https://ci.example/job/app/42"),
      expectBuild("https://ci.example/job/app/", 42)
    );
  });

  it("strips credentials, query and hash from resolved URLs", () => {
    assert.deepEqual(
      resolve("https://user:token@ci.example/job/app/5/console?x=1#y"),
      expectBuild("https://ci.example/job/app/", 5)
    );
    assert.deepEqual(resolveBuildReferenceUrl(new URL("https://u:p@ci.example/job/app/"), ENV), {
      kind: "job",
      jobUrl: "https://ci.example/job/app/"
    });
  });

  it("respects an environment context path", () => {
    assert.deepEqual(
      resolve("https://ci.example/jenkins/job/app/9/consoleFull", CONTEXT_ENV),
      expectBuild("https://ci.example/jenkins/job/app/", 9)
    );
    assert.deepEqual(resolve("https://ci.example/jenkins/job/app/configure", CONTEXT_ENV), {
      kind: "job",
      jobUrl: "https://ci.example/jenkins/job/app/"
    });
    assert.deepEqual(
      resolve(
        "https://ci.example/jenkins/blue/organizations/jenkins/app/detail/app/3/pipeline",
        CONTEXT_ENV
      ),
      expectBuild("https://ci.example/jenkins/job/app/", 3)
    );
    assert.deepEqual(resolve("https://ci.example/jenkins/manage/", CONTEXT_ENV).kind, "invalid");
  });

  it("treats a context path named job as context, not as a job marker", () => {
    assert.deepEqual(
      resolve("https://ci.example/job/job/app/4/console", "https://ci.example/job/"),
      expectBuild("https://ci.example/job/job/app/", 4)
    );
  });

  it.each([
    "https://ci.example/view/All/job/a/job/b/12/",
    "https://ci.example/view/Outer/view/Inner/job/a/job/b/12/console",
    "https://ci.example/job/a/view/Folder%20View/job/b/12/"
  ])("canonicalizes view-scoped URL %s to the environment root", (input) => {
    assert.deepEqual(resolve(input), expectBuild("https://ci.example/job/a/job/b/", 12));
  });

  it("round-trips encoded nested folder names exactly", () => {
    assert.deepEqual(
      resolve("https://ci.example/job/my%20folder/job/feature%2Fx/3/testReport/"),
      expectBuild("https://ci.example/job/my%20folder/job/feature%2Fx/", 3)
    );
    assert.deepEqual(
      resolve("https://ci.example/job/repo/job/feature%252Flogin/8/"),
      expectBuild("https://ci.example/job/repo/job/feature%252Flogin/", 8)
    );
  });

  it.each(JENKINS_BUILD_PERMALINKS)("resolves the %s permalink", (permalink) => {
    assert.deepEqual(resolve(`https://ci.example/job/a/job/b/${permalink}/console`), {
      kind: "permalink",
      jobUrl: "https://ci.example/job/a/job/b/",
      permalink
    });
  });

  it.each([
    "https://ci.example/job/a/",
    "https://ci.example/job/a",
    "https://ci.example/job/a/configure",
    "https://ci.example/job/a/changes",
    "https://ci.example/job/a/build?delay=0",
    "https://ci.example/job/a/lastbuild/",
    "https://ci.example/job/a/0/",
    "https://ci.example/job/a/job",
    "https://ci.example/view/All/job/a/ws/job/b/"
  ])("resolves %s to the job", (input) => {
    assert.deepEqual(resolve(input), { kind: "job", jobUrl: "https://ci.example/job/a/" });
  });

  it("skips nested folder views before a job", () => {
    assert.deepEqual(resolve("https://ci.example/job/team/view/v/view/w/job/app/1/console"), {
      kind: "build",
      buildUrl: "https://ci.example/job/team/job/app/1/",
      jobUrl: "https://ci.example/job/team/job/app/",
      buildNumber: 1
    });
  });

  it("resolves nested folder job pages to the innermost job", () => {
    assert.deepEqual(resolve("https://ci.example/job/f/job/app/pipeline-syntax/"), {
      kind: "job",
      jobUrl: "https://ci.example/job/f/job/app/"
    });
  });

  it("resolves Blue Ocean multibranch builds with a %2F branch", () => {
    // Jenkins multibranch names the branch job for feature/login "feature%2Flogin"; classic URLs
    // and Blue Ocean both encode that name again as feature%252Flogin.
    assert.deepEqual(
      resolve(
        "https://ci.example/blue/organizations/jenkins/team%2Fapp/detail/feature%252Flogin/7/pipeline/42"
      ),
      expectBuild("https://ci.example/job/team/job/app/job/feature%252Flogin/", 7)
    );
    assert.deepEqual(
      resolve("https://ci.example/blue/organizations/jenkins/team%2Fapp/detail/main/2/tests"),
      expectBuild("https://ci.example/job/team/job/app/job/main/", 2)
    );
  });

  it("resolves Blue Ocean builds of non-multibranch jobs", () => {
    assert.deepEqual(
      resolve("https://ci.example/blue/organizations/jenkins/app/detail/app/12/pipeline"),
      expectBuild("https://ci.example/job/app/", 12)
    );
    assert.deepEqual(
      resolve(
        "https://ci.example/blue/organizations/jenkins/my%20folder%2Fmy%20app/detail/my%20app/5/"
      ),
      expectBuild("https://ci.example/job/my%20folder/job/my%20app/", 5)
    );
  });

  it.each(["activity", "branches", "pr", ""])(
    "resolves the Blue Ocean %j page to the job",
    (page) => {
      assert.deepEqual(
        resolve(`https://ci.example/blue/organizations/jenkins/team%2Fapp/${page}`),
        { kind: "job", jobUrl: "https://ci.example/job/team/job/app/" }
      );
    }
  );

  it.each([
    "https://ci.example/",
    "https://ci.example/manage/",
    "https://ci.example/computer/agent-1/",
    "https://ci.example/view/All/",
    "https://ci.example/queue/item/5/",
    "https://ci.example/blue/pipelines",
    "https://ci.example/blue/organizations/jenkins/",
    "https://ci.example/blue/organizations/jenkins/app/detail/app/",
    "https://ci.example/blue/organizations/jenkins/app/detail/app/latest/",
    "https://ci.example/blue/organizations/jenkins/app/settings",
    "https://ci.example/job/bad%E0%A4/1/"
  ])("rejects %s", (input) => {
    const result = resolve(input);
    assert.equal(result.kind, "invalid");
    assert.match((result as { message: string }).message, /Jenkins job or build/);
  });
});

describe("formatBuildLabel", () => {
  it("formats build URLs as #n", () => {
    assert.equal(formatBuildLabel("https://ci.example/job/app/42/"), "#42");
    assert.equal(formatBuildLabel("https://ci.example/job/app/42"), "#42");
    assert.equal(formatBuildLabel("https://ci.example/job/app/"), undefined);
  });
});
