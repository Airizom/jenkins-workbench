import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseDeclarativeValidationOutput } from "../src/validation/JenkinsfileValidationParser";

describe("parseDeclarativeValidationOutput line references", () => {
  const cases = [
    {
      name: "WorkflowScript location",
      input: "WorkflowScript: 12: Expected a step",
      expected: { message: "Expected a step", line: 12, column: undefined }
    },
    {
      name: "WorkflowScript @ line location",
      input: "WorkflowScript: 12: Expected a step @ line 7, column 4",
      expected: { message: "Expected a step", line: 7, column: 4 }
    },
    {
      name: "@ line location without a column",
      input: "Expected a step @ line 8",
      expected: { message: "Expected a step", line: 8, column: undefined }
    },
    {
      name: "generic line location",
      input: "Expected a step on line 9, column 2",
      expected: { message: "Expected a step on line 9, column 2", line: 9, column: 2 }
    },
    {
      name: "empty WorkflowScript detail",
      input: "WorkflowScript: 10:",
      expected: { message: "WorkflowScript: 10:", line: 10, column: undefined }
    }
  ];

  for (const { name, input, expected } of cases) {
    it(`parses ${name}`, () => {
      const [finding] = parseDeclarativeValidationOutput(input);

      assert.deepEqual(
        finding && {
          message: finding.message,
          line: finding.line,
          column: finding.column
        },
        expected
      );
    });
  }
});
