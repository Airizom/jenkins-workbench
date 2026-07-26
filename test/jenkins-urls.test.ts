import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseBuildUrl, parseJobUrl } from "../src/jenkins/urls";

describe("Jenkins URL parsers", () => {
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

  it("rejects malformed percent-encoded build URL job paths without throwing", () => {
    assert.equal(parseBuildUrl("https://jenkins.example/job/%E0%A4%A/1/"), undefined);
  });
});
