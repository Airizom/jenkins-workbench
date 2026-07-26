import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { splitBuildDetailsErrors } from "../src/panels/buildDetails/shared/BuildDetailsErrorHelpers";

describe("splitBuildDetailsErrors", () => {
  it("omits an empty console output error", () => {
    assert.deepEqual(splitBuildDetailsErrors(["console output:"]), {
      consoleError: undefined,
      displayErrors: []
    });
  });
});
