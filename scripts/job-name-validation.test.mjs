import assert from "node:assert/strict";
import test from "node:test";

const { JENKINS_INVALID_JOB_NAME_CHARACTERS, formatJobNameValidationError, validateJobName } =
  await import("../out/commands/job/JobNameValidation.js");

const jenkinsInvalidCharacters = "?*/\\%!@#$^&|<>[]:;";

test("Jenkins job name invalid character set matches Jenkins checkGoodName", () => {
  assert.equal(JENKINS_INVALID_JOB_NAME_CHARACTERS, jenkinsInvalidCharacters);
});

test("validateJobName rejects every Jenkins invalid job name character", () => {
  for (const char of jenkinsInvalidCharacters) {
    assert.equal(validateJobName(`job${char}name`), "invalid_chars", `expected ${char}`);
  }
});

test("invalid character error includes the full Jenkins invalid character set", () => {
  assert.equal(
    formatJobNameValidationError("invalid_chars"),
    `Name contains invalid characters (${jenkinsInvalidCharacters} are not allowed).`
  );
});
