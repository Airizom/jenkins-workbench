import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  findTokenOccurrence,
  findTokenOccurrences
} from "../src/validation/JenkinsfileValidationUtils";

describe("JenkinsfileValidationUtils token lookup", () => {
  it("ignores empty tokens", () => {
    assert.equal(findTokenOccurrence("agent any", ""), undefined);
    assert.deepEqual(findTokenOccurrences("agent any", ""), []);
  });
});
