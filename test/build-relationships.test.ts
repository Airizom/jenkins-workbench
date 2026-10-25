import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  extractUpstreamBuilds,
  resolveBuildRelationship,
  resolveRelationshipJobUrl
} from "../src/jenkins/BuildRelationships";
import type { JenkinsBuild } from "../src/jenkins/types";

const base = "https://jenkins.example/jenkins/";
const build = (actions: unknown): JenkinsBuild =>
  ({ number: 1, url: `${base}job/current/1/`, actions }) as JenkinsBuild;

describe("build relationship normalization", () => {
  it("extracts and deduplicates direct upstream references across cause actions", () => {
    const cause = {
      upstreamProject: "team/parent",
      upstreamUrl: "job/team/job/parent/",
      upstreamBuild: 42
    };
    const result = extractUpstreamBuilds(
      base,
      build([
        null,
        {},
        {
          causes: [
            cause,
            { ...cause, upstreamCauses: [{ upstreamUrl: "job/ancestor/", upstreamBuild: 9 }] }
          ]
        },
        { causes: [cause, { upstreamUrl: "job/other/", upstreamBuild: 42 }] }
      ])
    );
    assert.deepEqual(
      result.map((entry) => [entry.jobName, entry.number]),
      [
        ["team/parent", 42],
        ["other", 42]
      ]
    );
    assert.equal(result[0].buildUrl, `${base}job/team/job/parent/42/`);
  });

  it("preserves encoded multibranch names and the Jenkins context path", () => {
    const result = resolveRelationshipJobUrl(base, "/jenkins/job/team/job/feature%252Ffix/");
    assert.equal(result?.jobName, "team/feature%2Ffix");
    assert.equal(result?.jobUrl, `${base}job/team/job/feature%252Ffix/`);
    assert.equal(resolveBuildRelationship(base, `${result?.jobUrl}14/`)?.number, 14);
  });

  it("rejects foreign origins, other context paths, credentials and malformed job paths", () => {
    for (const value of [
      "https://other.example/jenkins/job/a/",
      "https://jenkins.example/other/job/a/",
      "https://user:password@jenkins.example/jenkins/job/a/",
      "job/a/?token=secret",
      "job/a/#fragment",
      "job/a/trailing/",
      "job/%ZZ/",
      "javascript:alert(1)"
    ]) {
      assert.equal(resolveRelationshipJobUrl(base, value), undefined, value);
    }
  });

  it("rejects invalid build numbers and malformed actions without parsing descriptions", () => {
    for (const number of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "42", undefined]) {
      assert.deepEqual(
        extractUpstreamBuilds(
          base,
          build([{ causes: [{ upstreamUrl: "job/a/", upstreamBuild: number }] }])
        ),
        []
      );
    }
    assert.deepEqual(
      extractUpstreamBuilds(base, build([null, "bad", { causes: {} }, { causes: [null, {}] }])),
      []
    );
    assert.deepEqual(extractUpstreamBuilds(base, build({ causes: [] })), []);
    assert.deepEqual(
      extractUpstreamBuilds(
        base,
        build([{ causes: [{ shortDescription: "Started by job/a #42" }] }])
      ),
      []
    );
    assert.equal(resolveBuildRelationship(base, `${base}job/a/0/`), undefined);
    assert.equal(resolveBuildRelationship(base, `${base}job/a/1/?x=1`), undefined);
  });
});
