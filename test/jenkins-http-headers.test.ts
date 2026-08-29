import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { getHeaderFlags } from "../src/jenkins/client/JenkinsHttpHeaders";

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
