import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  deriveValidationCode,
  extractInvalidStepToken,
  findTokenOccurrence,
  findTokenOccurrences,
  mergeSuggestions
} from "../src/validation/JenkinsfileValidationUtils";

describe("JenkinsfileValidationUtils suggestion merging", () => {
  it("keeps order, drops case-insensitive duplicates, and caps at ten", () => {
    const incoming = ["echo", "bat", "SH", "a", "b", "c", "d", "e", "f", "g", "h"];
    assert.deepEqual(mergeSuggestions(["sh", "Echo"], incoming), [
      "sh",
      "Echo",
      "bat",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g"
    ]);
  });

  it("dedupes incoming suggestions when nothing exists yet", () => {
    assert.deepEqual(mergeSuggestions(undefined, ["sh", "SH", "bat"]), ["sh", "bat"]);
  });

  it("returns existing suggestions unchanged when nothing is incoming", () => {
    const existing = ["sh"];
    assert.equal(mergeSuggestions(existing, []), existing);
    assert.equal(mergeSuggestions(undefined, []), undefined);
  });
});

describe("JenkinsfileValidationUtils invalid step messages", () => {
  const cases = [
    {
      message: "Invalid step 'input' used - not allowed in this context",
      code: "blocked-step",
      token: "input"
    },
    { message: 'Invalid step "deploy_app"', code: "invalid-step", token: "deploy_app" },
    {
      message: "No such DSL method 'withFoo' found among steps",
      code: "unknown-dsl-method",
      token: "withFoo"
    },
    { message: "No such step checkout", code: "unknown-dsl-method", token: "checkout" },
    { message: 'Unknown step "custom-step"', code: "unknown-dsl-method", token: "custom-step" },
    {
      message: "Available symbols found among steps",
      code: "unknown-dsl-method",
      token: undefined
    },
    { message: "Unrelated Jenkins error", code: undefined, token: undefined }
  ] as const;

  for (const testCase of cases) {
    it(`parses ${testCase.message}`, () => {
      assert.equal(deriveValidationCode(testCase.message), testCase.code);
      assert.equal(extractInvalidStepToken(testCase.message), testCase.token);
    });
  }
});

describe("JenkinsfileValidationUtils token lookup", () => {
  it("ignores empty tokens", () => {
    assert.equal(findTokenOccurrence("agent any", ""), undefined);
    assert.deepEqual(findTokenOccurrences("agent any", ""), []);
  });

  it("preserves source offsets after Unicode characters that expand when lowercased", () => {
    assert.equal(findTokenOccurrence("İ sh()", "sh"), 2);
    assert.deepEqual(findTokenOccurrences("İ sh()", "sh"), [2]);
    assert.equal(findTokenOccurrence("İ SH(); İ sh()", "Sh"), 2);
    assert.deepEqual(findTokenOccurrences("İ SH(); İ sh()", "Sh"), [2, 10]);
  });

  it("checks token boundaries at the original source offsets", () => {
    const line = "İ shSuffix(); prefixSh(); sh()";
    assert.equal(findTokenOccurrence(line, "sh"), 26);
    assert.deepEqual(findTokenOccurrences(line, "sh"), [26]);
  });
});
