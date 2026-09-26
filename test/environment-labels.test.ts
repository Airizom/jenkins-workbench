import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatEnvironmentLabel } from "../src/jenkins/EnvironmentLabels";

describe("formatEnvironmentLabel", () => {
  it.each([
    ["https://jenkins.example/", "jenkins.example"],
    ["http://jenkins.example:8080/ci/", "jenkins.example:8080/ci"],
    ["jenkins.example/ci", "jenkins.example/ci"],
    ["localhost:8080", "localhost:8080"],
    ["jenkins:8080/path", "jenkins:8080/path"]
  ])("formats %s as %s", (rawUrl, expected) => {
    assert.equal(formatEnvironmentLabel(rawUrl), expected);
  });
});
