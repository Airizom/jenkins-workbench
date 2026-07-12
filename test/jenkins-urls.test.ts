import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseBuildUrl, parseJobUrl } from "../src/jenkins/urls";

describe("Jenkins URL parsers", () => {
  it("rejects malformed percent-encoded job URL paths without throwing", () => {
    assert.equal(parseJobUrl("https://jenkins.example/job/%E0%A4%A"), undefined);
  });

  it("rejects malformed percent-encoded build URL job paths without throwing", () => {
    assert.equal(parseBuildUrl("https://jenkins.example/job/%E0%A4%A/1/"), undefined);
  });
});
