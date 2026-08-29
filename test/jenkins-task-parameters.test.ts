import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseTaskParameters } from "../src/tasks/JenkinsTaskTypes";

describe("parseTaskParameters", () => {
  it("normalizes equivalent object and name/value array definitions identically", () => {
    const objectResult = parseTaskParameters({ " COUNT ": 2, CHOICE: ["a", false] });
    const arrayResult = parseTaskParameters([
      { name: " COUNT ", value: 2 },
      { name: "CHOICE", value: ["a", false] }
    ]);

    assert.equal(objectResult.error, undefined);
    assert.equal(arrayResult.error, undefined);
    assert.equal(objectResult.params?.toString(), "COUNT=2&CHOICE=a&CHOICE=false");
    assert.equal(arrayResult.params?.toString(), objectResult.params?.toString());
  });

  it("rejects blank names consistently across both encodings", () => {
    const objectResult = parseTaskParameters({ "   ": "value" });
    const arrayResult = parseTaskParameters([{ name: "   ", value: "value" }]);

    assert.equal(objectResult.error, "Invalid parameter values for: parameters.");
    assert.equal(arrayResult.error, objectResult.error);
  });
});
