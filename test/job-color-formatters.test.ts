import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isJobColorDisabled, resolveJobColorStatus } from "../src/formatters/JobColorFormatters";

describe("job color classification", () => {
  it("treats grey and gray as not built rather than disabled", () => {
    for (const color of ["grey", "gray", "GREY", "grey_anime"]) {
      assert.equal(isJobColorDisabled(color), false, color);
    }
    assert.equal(resolveJobColorStatus("grey"), "notBuilt");
    assert.equal(resolveJobColorStatus("gray"), "notBuilt");
  });

  it("keeps the explicit disabled color disabled", () => {
    assert.equal(isJobColorDisabled("disabled"), true);
    assert.equal(isJobColorDisabled("disabled_anime"), true);
    assert.equal(resolveJobColorStatus("disabled"), "disabled");
  });
});
