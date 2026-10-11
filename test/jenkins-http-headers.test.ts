import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildHeadersWithCrumb, getHeaderFlags } from "../src/jenkins/client/JenkinsHttpHeaders";

describe("buildHeadersWithCrumb", () => {
  it("merges cookies by name and uses the session returned with the crumb", () => {
    const baseHeaders = { cOoKiE: "auth=token==; JSESSIONID=old", "X-Auth": "secret" };
    const contentHeaders = { cookie: "preference=compact; JSESSIONID=stale" };

    assert.deepEqual(
      buildHeadersWithCrumb(
        contentHeaders,
        { field: "Jenkins-Crumb", value: "crumb", cookie: "JSESSIONID=fresh; route=node1" },
        baseHeaders
      ),
      {
        "X-Auth": "secret",
        "Jenkins-Crumb": "crumb",
        Cookie: "auth=token==; JSESSIONID=fresh; preference=compact; route=node1"
      }
    );
    assert.equal(baseHeaders.cOoKiE, "auth=token==; JSESSIONID=old");
    assert.equal(contentHeaders.cookie, "preference=compact; JSESSIONID=stale");
  });

  it.each([undefined, { field: "Jenkins-Crumb", value: "crumb" }])(
    "preserves authentication headers when no crumb cookie is returned: %j",
    (crumb) => {
      assert.deepEqual(
        buildHeadersWithCrumb({ "Content-Length": "0" }, crumb, { Cookie: "auth=token" }),
        {
          Cookie: "auth=token",
          "Content-Length": "0",
          ...(crumb ? { "Jenkins-Crumb": "crumb" } : {})
        }
      );
    }
  );
});

describe("getHeaderFlags", () => {
  const inheritedOnlyHeaders = Object.create({ Cookie: "inherited" }) as Record<string, string>;

  it.each([
    ["undefined headers", undefined, { hasHeaders: false, hasCookie: false }],
    ["empty headers", {}, { hasHeaders: false, hasCookie: false }],
    ["inherited-only headers", inheritedOnlyHeaders, { hasHeaders: false, hasCookie: false }],
    ["ordinary headers", { Accept: "application/json" }, { hasHeaders: true, hasCookie: false }],
    ["mixed-case Cookie headers", { cOoKiE: "session=1" }, { hasHeaders: true, hasCookie: true }]
  ] as const)("classifies %s", (_name, headers, expected) => {
    assert.deepEqual(getHeaderFlags(headers), expected);
  });
});
