import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUriQueryParams } from "../src/extension/UriQueryParams";

describe("parseUriQueryParams", () => {
  it("preserves percent-encoded sequences instead of decoding them again", () => {
    const params = parseUriQueryParams(
      "url=https://jenkins.example/job/repo/job/feature%2Fbranch/"
    );

    assert.equal(params.get("url"), "https://jenkins.example/job/repo/job/feature%2Fbranch/");
  });

  it("keeps literal plus signs instead of converting them to spaces", () => {
    const params = parseUriQueryParams("nodeName=build+and+test");

    assert.equal(params.get("nodeName"), "build+and+test");
  });

  it("splits multiple parameters on ampersands", () => {
    const params = parseUriQueryParams(
      "url=https://jenkins.example/job/app/12/&nodeId=42&nodeKind=stage"
    );

    assert.equal(params.get("url"), "https://jenkins.example/job/app/12/");
    assert.equal(params.get("nodeId"), "42");
    assert.equal(params.get("nodeKind"), "stage");
  });

  it("splits on the first equals sign so values may contain equals signs", () => {
    const params = parseUriQueryParams(
      "url=https://jenkins.example/job/app/api/json?tree=builds[number]&nodeId=7"
    );

    assert.equal(params.get("url"), "https://jenkins.example/job/app/api/json?tree=builds[number]");
    assert.equal(params.get("nodeId"), "7");
  });

  it("returns the first value for repeated keys and empty values for bare keys", () => {
    const params = parseUriQueryParams("url=first&url=second&flag");

    assert.equal(params.get("url"), "first");
    assert.equal(params.get("flag"), "");
    assert.equal(parseUriQueryParams("").size, 0);
  });
});
