import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseTaskParameters } from "../src/tasks/JenkinsTaskTypes";

describe("parseTaskParameters", () => {
  it("expands object-form array parameter values", () => {
    const result = parseTaskParameters({ CHOICE: ["a", "b"] });

    assert.equal(result.error, undefined);
    assert.deepEqual(result.params?.getAll("CHOICE"), ["a", "b"]);
  });

  it("expands array-form name/value array parameter values", () => {
    const result = parseTaskParameters([{ name: "CHOICE", value: ["a", "b"] }]);

    assert.equal(result.error, undefined);
    assert.deepEqual(result.params?.getAll("CHOICE"), ["a", "b"]);
  });
});
