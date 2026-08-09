import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  deriveValidationCode,
  extractInvalidStepToken,
  findTokenOccurrence,
  findTokenOccurrences
} from "../src/validation/JenkinsfileValidationUtils";

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
});
