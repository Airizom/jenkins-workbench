import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseDeepLinkPayload, parseUriQueryParams } from "../src/extension/UriQueryParams";

describe("parseUriQueryParams", () => {
  it("round-trips a nested URL and node selection in an encoded payload", () => {
    const fields = {
      url: "https://ci.example/job/app/1/?nodeId=inner&x=2",
      nodeId: "outer",
      nodeKind: "step",
      nodeName: "build & test"
    };
    const payload = Buffer.from(JSON.stringify(fields), "utf8").toString("base64url");
    const parsed = parseDeepLinkPayload(`payload=${payload}`);

    assert.deepEqual(Object.fromEntries(parsed ?? []), fields);
    assert.equal(parseDeepLinkPayload("payload=broken&nodeId=outer"), undefined);
  });

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
      "nodeId=7&url=https://jenkins.example/job/app/api/json?tree=builds[number]",
      new Set(["url", "nodeId"])
    );

    assert.equal(params.get("url"), "https://jenkins.example/job/app/api/json?tree=builds[number]");
    assert.equal(params.get("nodeId"), "7");
  });

  it("keeps an encoded ampersand in a nested URL after VS Code decodes the query", () => {
    const nestedUrl = "https://ci.example/job/feature%2Fbranch/build?x=1&y=2";
    const encodedQuery = `nodeId=7&url=${encodeURIComponent(nestedUrl)}`;
    const params = parseUriQueryParams(
      decodeURIComponent(encodedQuery),
      new Set(["url", "nodeId", "nodeKind", "nodeName"])
    );

    assert.equal(params.get("url"), nestedUrl);
    assert.equal(params.get("nodeId"), "7");
    assert.equal(params.has("y"), false);
  });

  it("keeps recognized parameter names inside a nested URL query", () => {
    const params = parseUriQueryParams(
      "nodeId=outer&url=https://ci.example/job/app/1/?x=1&nodeId=inner&nodeKind=stage",
      new Set(["url", "nodeId", "nodeKind", "nodeName"])
    );

    assert.equal(params.get("nodeId"), "outer");
    assert.equal(
      params.get("url"),
      "https://ci.example/job/app/1/?x=1&nodeId=inner&nodeKind=stage"
    );
    assert.equal(params.has("nodeKind"), false);
  });

  it("preserves the full nested URL when an old link is ambiguous", () => {
    const nestedUrl = "https://ci.example/job/app/1/?x=1&y=2";
    const decodedQuery = decodeURIComponent(`url=${encodeURIComponent(nestedUrl)}&nodeId=outer`);
    const params = parseUriQueryParams(decodedQuery, new Set(["url", "nodeId"]));

    assert.equal(params.get("url"), `${nestedUrl}&nodeId=outer`);
    assert.equal(params.has("nodeId"), false);
  });

  it("returns the first value for repeated keys and empty values for bare keys", () => {
    const params = parseUriQueryParams("url=first&url=second&flag");

    assert.equal(params.get("url"), "first");
    assert.equal(params.get("flag"), "");
    assert.equal(parseUriQueryParams("").size, 0);
  });
});
