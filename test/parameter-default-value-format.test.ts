import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatParameterDefaultValue } from "../src/jenkins/parameterDefaultValueFormat";

describe("formatParameterDefaultValue", () => {
  it("returns JSON primitives unchanged", () => {
    assert.equal(formatParameterDefaultValue("main"), "main");
    assert.equal(formatParameterDefaultValue(3), 3);
    assert.equal(formatParameterDefaultValue(false), false);
  });

  it("returns undefined for missing or null values", () => {
    assert.equal(formatParameterDefaultValue(undefined), undefined);
    assert.equal(formatParameterDefaultValue(null), undefined);
  });

  it("stringifies array entries and serializes objects", () => {
    assert.deepEqual(formatParameterDefaultValue(["a", 1, true]), ["a", "1", "true"]);
    assert.equal(formatParameterDefaultValue({ key: "value" }), '{"key":"value"}');
  });
});
