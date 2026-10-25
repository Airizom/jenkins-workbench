import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  formatEnvironmentDisplayName,
  formatEnvironmentLabel
} from "../src/jenkins/EnvironmentLabels";

describe("formatEnvironmentLabel", () => {
  it.each([
    ["https://jenkins.example/", "jenkins.example"],
    ["http://jenkins.example:8080/ci/", "jenkins.example:8080/ci"],
    ["jenkins.example/ci", "jenkins.example/ci"],
    ["localhost:8080", "localhost:8080"],
    ["jenkins:8080/path", "jenkins:8080/path"],
    ["host:8080", "host:8080"],
    ["https://host/jenkins/", "host/jenkins"],
    ["not a url", "not a url"],
    ["http://", "http://"]
  ])("formats %s as %s", (rawUrl, expected) => {
    assert.equal(formatEnvironmentLabel(rawUrl), expected);
  });
});

describe("formatEnvironmentDisplayName", () => {
  it("uses the trimmed name when one is set", () => {
    assert.equal(
      formatEnvironmentDisplayName({ name: "  Production  ", url: "https://jenkins.example/" }),
      "Production"
    );
  });

  it("falls back to the host label for a whitespace-only name", () => {
    assert.equal(
      formatEnvironmentDisplayName({ name: "   ", url: "https://jenkins.example/ci/" }),
      "jenkins.example/ci"
    );
  });

  it("falls back to the host label when no name is set", () => {
    assert.equal(
      formatEnvironmentDisplayName({ url: "http://jenkins.example:8080/" }),
      "jenkins.example:8080"
    );
  });
});
