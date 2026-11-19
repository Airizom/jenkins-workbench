import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildJobUrl,
  buildWorkspaceDirectoryListingUrl,
  canonicalizeBuildUrlForEnvironment,
  canonicalizeJobUrlForEnvironment,
  isAuthRedirect,
  parseBuildUrl,
  parseJobUrl,
  resolveBuildIdentityForEnvironment,
  resolveExactJobUrlForEnvironment
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

  it.each([
    ["https://public/job/", "http://internal/job/team/job/app/7/", "job/team/job/app/7/"],
    ["https://public/job/", "https://public/job/team/job/app/7/", "job/team/job/app/7/"],
    ["https://public/job/", "https://public/job/job/team/job/app/7/", "job/team/job/app/7/"],
    ["https://public/job/", "/job/team/job/app/7/", "job/team/job/app/7/"],
    ["https://public/job/team/", "/job/team/job/app/7/", undefined],
    ["https://public/job/team/", "job/app/7/", "job/app/7/"],
    ["https://public/job/team/", "//public/job/team/job/app/7/", "job/app/7/"],
    ["https://public/view/", "http://internal/view/job/job/team/job/app/7/", "job/team/job/app/7/"],
    ["https://public/job/", "http://internal/job/job/job/view/7/", "job/job/job/view/7/"],
    ["https://public/job/", "http://internal/job/view/job/job/job/7/", "job/job/7/"],
    ["https://public/job/team/", "https://public/job/team/job/app/7/", "job/app/7/"],
    ["https://public/job/job/", "http://internal/job/job/job/app/7/", undefined]
  ])("checks both route boundaries for %s and %s", (configured, reported, suffix) => {
    assert.equal(
      resolveBuildIdentityForEnvironment(configured, reported)?.buildUrl,
      suffix ? `${configured}${suffix}` : undefined
    );
  });

  it("requires a route boundary after the configured context for a same-origin queue task", () => {
    const environmentUrl = "https://public/job/";
    const nested = "https://public/job/job/team/job/app/";
    assert.equal(
      resolveExactJobUrlForEnvironment(environmentUrl, "https://public/job/team/job/app/"),
      nested
    );
    assert.equal(resolveExactJobUrlForEnvironment(environmentUrl, nested), nested);
  });

  it.each(["job/app/", "view/All/job/app/"])(
    "recognizes %s after an internal controller's view context",
    (path) => {
      const environmentUrl = "https://public/ci/";
      const task = `http://internal/view/${path}`;
      assert.equal(
        canonicalizeJobUrlForEnvironment(environmentUrl, task),
        `${environmentUrl}job/app/`
      );
      assert.equal(
        canonicalizeJobUrlForEnvironment(environmentUrl, `https://public/view/${path}`),
        `${environmentUrl}job/app/`
      );
      assert.equal(
        resolveExactJobUrlForEnvironment(environmentUrl, task),
        `${environmentUrl}job/app/`
      );
      assert.equal(
        resolveBuildIdentityForEnvironment(environmentUrl, `${task}7/`)?.buildUrl,
        `${environmentUrl}job/app/7/`
      );
      assert.equal(
        resolveBuildIdentityForEnvironment(
          environmentUrl,
          "http://internal/view/job/job/os=linux/7/"
        )?.buildUrl,
        undefined
      );
    }
  );

  it.each([
    ["http://internal", "https://public/ci/"],
    ["https://public", "https://public/ci/"],
    ["http://internal", "https://public/"],
    ["https://public", "https://public/"]
  ])(
    "skips an internal proxy prefix containing view segments on %s for controller %s",
    (origin, env) => {
      for (const prefix of ["view/team/jenkins", "view", "view/view/All"]) {
        const task = `${origin}/${prefix}/job/app/`;
        assert.equal(canonicalizeJobUrlForEnvironment(env, task), `${env}job/app/`);
        const publicViewAction = task.startsWith(env);
        assert.equal(
          resolveExactJobUrlForEnvironment(env, task),
          publicViewAction ? undefined : `${env}job/app/`
        );
        assert.equal(
          resolveBuildIdentityForEnvironment(env, `${task}7/`, "request", { buildNumber: 7 })
            ?.buildUrl,
          publicViewAction ? `${task}7/` : `${env}job/app/7/`
        );
      }
      const ambiguous = `${origin}/view/job/jenkins/job/app/`;
      assert.equal(resolveExactJobUrlForEnvironment(env, ambiguous), undefined);
      assert.equal(resolveBuildIdentityForEnvironment(env, `${ambiguous}7/`)?.buildUrl, undefined);
    }
  );

  it("requires a job route after a configured job-shaped context in a run-parameter reference", () => {
    const environmentUrl = "https://ci/job/team/";
    assert.equal(parseJobUrl(`${environmentUrl}upstream/`, environmentUrl), undefined);
    assert.deepEqual(parseJobUrl(`${environmentUrl}job/upstream/`, environmentUrl)?.fullPath, [
      "upstream"
    ]);
  });

  it.each(["https://public", "http://internal"])(
    "recognizes a job-shaped mount on %s and stops at a numbered build subpage",
    (origin) => {
      const env = "https://public/";
      const task = `${origin}/job/job/team/job/app/`;
      assert.equal(resolveExactJobUrlForEnvironment(env, task), `${env}job/team/job/app/`);
      assert.equal(
        resolveBuildIdentityForEnvironment(env, `${task}7/`)?.buildUrl,
        `${env}job/team/job/app/7/`
      );
      const artifact = `${origin}/view/job/app/42/artifact/job/foo/7/`;
      assert.equal(
        resolveBuildIdentityForEnvironment(env, artifact, "request", { buildNumber: 7 }),
        undefined
      );
    }
  );

  it.each(["os=linux", "com.example$library"])(
    "requires an unambiguous plain job before deriving a run URL for %s",
    (child) => {
      const environmentUrl = "https://public/job/";
      const taskPath = `job/job/job/${child}/`;
      assert.equal(resolveExactJobUrlForEnvironment(environmentUrl, `/${taskPath}`), undefined);
      assert.equal(
        resolveExactJobUrlForEnvironment(environmentUrl, `http://internal/${taskPath}`),
        undefined
      );
      assert.equal(
        resolveExactJobUrlForEnvironment(environmentUrl, `${environmentUrl}${taskPath}`),
        `${environmentUrl}job/job/job/${encodeURIComponent(child)}/`
      );
    }
  );

  it("retains canonicalization for URLs outside the environment context", () => {
    assert.equal(
      canonicalizeJobUrlForEnvironment(
        "https://jenkins.example/job/",
        "https://internal.example/jobs/job/demo/"
      ),
      "https://jenkins.example/job/job/demo/"
    );
  });

  it("preserves advertised parents for rebuild and comparison and canonical action endpoints", () => {
    const environmentUrl = "https://ci/";
    for (const prefix of ["jenkins/", "plugin/example/"]) {
      const parent = `${environmentUrl}${prefix}job/app/`;
      assert.deepEqual(parseBuildUrl(`${parent}42/`, environmentUrl), {
        jobUrl: parent,
        buildNumber: 42
      });
      assert.equal(
        canonicalizeBuildUrlForEnvironment(environmentUrl, `${parent}42/`),
        "https://ci/job/app/42/"
      );
    }
  });

  it.each(["os=linux,jdk=21", "com.example$module"])(
    "retains project child %s in the command target",
    (child) => {
      const parent = `https://ci/mount/view/job/job/app/${child}/`;
      assert.deepEqual(parseBuildUrl(`${parent}42/`, "https://ci/"), {
        jobUrl: parent,
        buildNumber: 42
      });
      assert.equal(canonicalizeBuildUrlForEnvironment("https://ci/", `${parent}42/`), undefined);
    }
  );

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
