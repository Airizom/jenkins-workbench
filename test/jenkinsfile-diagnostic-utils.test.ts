import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type * as vscode from "vscode";
import { setDiagnosticMetadata } from "../src/validation/JenkinsfileDiagnosticMetadata";
import {
  JENKINS_DIAGNOSTIC_SOURCE,
  resolveDiagnosticCode
} from "../src/validation/JenkinsfileDiagnosticUtils";
import { JENKINSFILE_VALIDATION_CODES } from "../src/validation/JenkinsfileValidationTypes";

interface TestDiagnostic {
  source?: string;
  message: string;
  code?: string | { value: string };
}

function createDiagnostic(overrides: Partial<TestDiagnostic> = {}): vscode.Diagnostic {
  return {
    source: JENKINS_DIAGNOSTIC_SOURCE,
    message: "No Jenkinsfile validation code",
    ...overrides
  } as unknown as vscode.Diagnostic;
}

describe("JenkinsfileDiagnosticUtils resolveDiagnosticCode", () => {
  it("resolves diagnostic codes independently of metadata", () => {
    const diagnostic = createDiagnostic({ code: "missing-agent" });
    setDiagnosticMetadata(diagnostic, { suggestions: ["stage"] });

    assert.equal(resolveDiagnosticCode(diagnostic), "missing-agent");
  });

  it("resolves string and object diagnostic codes from Jenkins diagnostics", () => {
    assert.equal(resolveDiagnosticCode(createDiagnostic({ code: "invalid-step" })), "invalid-step");
    assert.equal(
      resolveDiagnosticCode(createDiagnostic({ code: { value: "unknown-dsl-method" } })),
      "unknown-dsl-method"
    );
  });

  it("resolves every shared validation code", () => {
    for (const code of JENKINSFILE_VALIDATION_CODES) {
      assert.equal(resolveDiagnosticCode(createDiagnostic({ code })), code);
    }
  });

  it("derives a code from Jenkins diagnostic messages when explicit codes are unavailable", () => {
    const diagnostic = createDiagnostic({
      message: "Missing required section 'agent'"
    });

    assert.equal(resolveDiagnosticCode(diagnostic), "missing-agent");
  });

  it("ignores non-Jenkins diagnostics without metadata", () => {
    const diagnostic = createDiagnostic({
      source: "typescript",
      message: "Declarative pipeline must contain an agent section",
      code: "missing-agent"
    });

    assert.equal(resolveDiagnosticCode(diagnostic), undefined);
  });
});
