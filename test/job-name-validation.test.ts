import { describe, expect, it } from "vitest";
import { getJobNameValidationError } from "../src/commands/job/JobNameValidation";

describe("getJobNameValidationError", () => {
  it.each([0x00, 0x1f, 0x7f, 0x85, 0x9f])("rejects ISO control code %i", (code) => {
    expect(getJobNameValidationError(`job${String.fromCharCode(code)}name`)).toBe(
      "Name cannot contain control characters."
    );
  });

  it.each([0x20, 0x7e, 0xa0])("accepts adjacent non-control code %i", (code) => {
    expect(getJobNameValidationError(`job${String.fromCharCode(code)}name`)).toBeUndefined();
  });
});
