import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { describe, it } from "vitest";
import { buildValidationDiagnostics } from "../src/validation/JenkinsfileValidationDiagnostics";
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

describe("parseDeclarativeValidationOutput JSON object locations", () => {
  const message = "Invalid section definition 'foo' @ line 5, column 3";

  it("uses an embedded location for a diagnostic", () => {
    const findings = parseDeclarativeValidationOutput(
      JSON.stringify({ data: { errors: [{ error: message }] } })
    );
    const lines = ["pipeline {", "  agent any", "  stages {", "    steps {", "  foo"];
    const document = {
      lineCount: lines.length,
      lineAt: (index: number) => ({ text: lines[index] })
    } as vscode.TextDocument;
    const [diagnostic] = buildValidationDiagnostics(document, findings);

    assert.equal(findings[0].message, "Invalid section definition 'foo'");
    assert.equal(findings[0].line, 5);
    assert.equal(findings[0].column, 3);
    assert.equal(diagnostic.range.start.line, 4);
    assert.equal(diagnostic.range.start.character, 2);
  });

  it("preserves explicit location fields over embedded values", () => {
    const [finding] = parseDeclarativeValidationOutput(
      JSON.stringify({ data: { errors: [{ error: message, line: 2, column: 1 }] } })
    );

    assert.equal(finding.line, 2);
    assert.equal(finding.column, 1);
  });

  it("fills a missing column without replacing an explicit line", () => {
    const [finding] = parseDeclarativeValidationOutput(
      JSON.stringify({ data: { errors: [{ error: message, line: 2 }] } })
    );

    assert.equal(finding.line, 2);
    assert.equal(finding.column, 3);
  });
});

describe("parseDeclarativeValidationOutput success responses", () => {
  it("retains a located error after a success phrase", () => {
    const findings = parseDeclarativeValidationOutput(
      "Jenkinsfile is valid\nWorkflowScript: 3: Invalid section definition 'foo' @ line 3, column 1"
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].message, "Invalid section definition 'foo'");
    assert.equal(findings[0].line, 3);
    assert.equal(findings[0].column, 1);
  });

  it("accepts an exact text success response", () => {
    assert.deepEqual(parseDeclarativeValidationOutput("Jenkinsfile successfully validated."), []);
  });

  for (const result of ["unsuccessful", "not ok"]) {
    it(`does not accept JSON result ${result} as success`, () => {
      const input = JSON.stringify({ result });
      assert.deepEqual(parseDeclarativeValidationOutput(input), [{ message: input }]);
    });
  }

  it("accepts an exact JSON success result", () => {
    assert.deepEqual(parseDeclarativeValidationOutput('{"result":"success"}'), []);
  });
});

it("unpacks Jenkins array-valued validation messages", () => {
  const findings = parseDeclarativeValidationOutput(
    JSON.stringify({
      status: "ok",
      data: {
        result: "failure",
        errors: [
          {
            error: [
              'Only "agent none", "agent any" or "agent {...}" are allowed..',
              "No agent type specified. Must be one of [any, label, none]."
            ],
            line: 2,
            column: 3
          }
        ]
      }
    })
  );
  assert.equal(findings.length, 2);
  assert.equal(
    findings[0].message,
    'Only "agent none", "agent any" or "agent {...}" are allowed..'
  );
  assert.equal(findings[1].message, "No agent type specified. Must be one of [any, label, none].");
  assert.equal(findings[0].line, 2);
  assert.equal(findings[1].column, 3);
});
