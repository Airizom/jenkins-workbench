import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildJobUrl,
  buildWorkspaceDirectoryListingUrl,
  canonicalizeBuildUrlForEnvironment,
  canonicalizeJobUrlForEnvironment,
  isAuthRedirect,
  parseBuildUrl,
  parseJobUrl
} from "../src/jenkins/urls";

describe("Jenkins URL parsers", () => {
  it.each(["", "jenkins/", "job/", "login/", "job/login/job/"])(
    "parses and canonicalizes jobs and builds under context %j",
    (contextPath) => {
      const environmentUrl = `https://jenkins.example/${contextPath}`;
      for (const jobName of ["demo", "job", "login"]) {
        const jobUrl = `${environmentUrl}job/${jobName}/`;
        const buildUrl = `${jobUrl}42/`;
        assert.deepEqual(parseJobUrl(jobUrl, environmentUrl), {
          parentUrl: environmentUrl,
          jobName,
          fullPath: [jobName]
        });
        assert.deepEqual(parseBuildUrl(buildUrl, environmentUrl), {
          jobUrl,
          buildNumber: 42
        });
        assert.equal(canonicalizeJobUrlForEnvironment(environmentUrl, jobUrl), jobUrl);
        assert.equal(canonicalizeBuildUrlForEnvironment(environmentUrl, buildUrl), buildUrl);
      }
    }
  );

  it("canonicalizes nested view-scoped URLs from another host under a reserved context", () => {
    const environmentUrl = "https://jenkins.example/job/";
    const jobUrl = "https://internal.example/job/view/all/job/job/job/login/";
    assert.deepEqual(parseJobUrl(jobUrl, environmentUrl), {
      parentUrl: "https://internal.example/job/view/all/job/job/",
      jobName: "login",
      fullPath: ["job", "login"]
    });
    assert.equal(
      canonicalizeJobUrlForEnvironment(environmentUrl, jobUrl),
      `${environmentUrl}job/job/job/login/`
    );
    assert.equal(
      canonicalizeBuildUrlForEnvironment(environmentUrl, `${jobUrl}42/`),
      `${environmentUrl}job/job/job/login/42/`
    );
  });

  it("retains canonicalization for URLs outside the environment context", () => {
    assert.equal(
      canonicalizeJobUrlForEnvironment(
        "https://jenkins.example/job/",
        "https://internal.example/jobs/job/demo/"
      ),
      "https://jenkins.example/job/job/demo/"
    );
  });

  it("parses nested job paths with a Jenkins context path", () => {
    assert.deepEqual(
      parseJobUrl("https://jenkins.example/jenkins/job/folder/job/encoded%20name/"),
      {
        parentUrl: "https://jenkins.example/jenkins/job/folder/",
        jobName: "encoded name",
        fullPath: ["folder", "encoded name"]
      }
    );
  });

  it.each([
    {
      buildUrl: "https://jenkins.example/job/project/42/",
      expectedJobUrl: "https://jenkins.example/job/project/",
      expectedBuildNumber: 42
    },
    {
      buildUrl: "https://jenkins.example/jenkins/job/folder/job/nested/7/",
      expectedJobUrl: "https://jenkins.example/jenkins/job/folder/job/nested/",
      expectedBuildNumber: 7
    },
    {
      buildUrl: "https://jenkins.example//job//folder//job//encoded%20name//15//",
      expectedJobUrl: "https://jenkins.example/job/folder/job/encoded%20name/",
      expectedBuildNumber: 15
    }
  ])(
    "parses and normalizes build URL $buildUrl",
    ({ buildUrl, expectedJobUrl, expectedBuildNumber }) => {
      assert.deepEqual(parseBuildUrl(buildUrl), {
        jobUrl: expectedJobUrl,
        buildNumber: expectedBuildNumber
      });
    }
  );

  it("rejects malformed percent-encoded job URL paths without throwing", () => {
    assert.equal(parseJobUrl("https://jenkins.example/job/%E0%A4%A"), undefined);
  });

  it.each([
    "https://jenkins.example/job/project/3/artifact/out/12",
    "https://jenkins.example/job/project/view/12/"
  ])("rejects build URL %s whose number does not follow a job name", (buildUrl) => {
    assert.equal(parseBuildUrl(buildUrl), undefined);
  });

  it("rejects malformed percent-encoded build URL job paths without throwing", () => {
    assert.equal(parseBuildUrl("https://jenkins.example/job/%E0%A4%A/1/"), undefined);
  });

  it("builds parent URLs that match buildJobUrl for encoded folder names", () => {
    const environmentUrl = "https://h/ctx/";
    assert.equal(
      parseJobUrl("https://h/ctx/job/a%20b/job/c/", environmentUrl)?.parentUrl,
      buildJobUrl(environmentUrl, "a b")
    );
  });

  it.each(["a b", "100%", "x/y"])("round-trips job name %j through buildJobUrl", (jobName) => {
    const parentUrl = buildJobUrl("https://h/ctx/", "folder");
    const jobUrl = buildJobUrl(parentUrl, jobName);
    assert.deepEqual(parseJobUrl(jobUrl, "https://h/ctx/"), {
      parentUrl,
      jobName,
      fullPath: ["folder", jobName]
    });
  });
});

describe("isAuthRedirect", () => {
  const base = "https://jenkins.example/";

  it.each(["jenkins/", "job/", "login/", "job/login/job/"])(
    "distinguishes authentication routes from context %j and job names",
    (contextPath) => {
      const environmentUrl = `${base}${contextPath}`;
      assert.equal(isAuthRedirect(`/${contextPath}login`, environmentUrl), true);
      assert.equal(
        isAuthRedirect(`/${contextPath}securityRealm/commenceLogin`, environmentUrl),
        true
      );
      assert.equal(isAuthRedirect(environmentUrl, environmentUrl), false);
      for (const jobName of ["demo", "job", "login"]) {
        assert.equal(isAuthRedirect(`/${contextPath}job/${jobName}/`, environmentUrl), false);
      }
    }
  );

  it.each([
    ["/login?from=%2F", base],
    ["/loginError", base],
    ["/loginEntry?from=%2F", base],
    ["/j_acegi_security_check", base],
    ["/jenkins/securityRealm/commenceLogin", "https://jenkins.example/jenkins/"]
  ])("detects auth redirect %s", (location, baseUrl) => {
    assert.equal(isAuthRedirect(location, baseUrl), true);
  });

  it.each([
    "/job/login-service/",
    "https://jenkins.example/job/securityrealm-tests/",
    "/job/folder/job/securityRealmTests/",
    "/job/folder/job/login/",
    "/view/loginTests/"
  ])("ignores non-auth redirect %s", (location) => {
    assert.equal(isAuthRedirect(location, base), false);
  });
});

describe("buildWorkspaceDirectoryListingUrl", () => {
  const jobUrl = "https://jenkins.example/job/project/";

  it.each(["/", "//", "///"])("treats slash-only path %j as the workspace root", (relativePath) => {
    assert.equal(
      buildWorkspaceDirectoryListingUrl(jobUrl, relativePath),
      buildWorkspaceDirectoryListingUrl(jobUrl)
    );
    assert.equal(
      buildWorkspaceDirectoryListingUrl(jobUrl, relativePath),
      "https://jenkins.example/job/project/ws/*plain*/"
    );
  });

  it("encodes nested relative paths", () => {
    assert.equal(
      buildWorkspaceDirectoryListingUrl(jobUrl, "/src/my dir/"),
      "https://jenkins.example/job/project/ws/src/my%20dir/*plain*/"
    );
  });
});
