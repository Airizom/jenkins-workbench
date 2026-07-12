import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type * as vscode from "vscode";
import { setDiagnosticMetadata } from "../src/validation/JenkinsfileDiagnosticMetadata";
import {
  JENKINS_DIAGNOSTIC_SOURCE,
  resolveDiagnosticCode
} from "../src/validation/JenkinsfileDiagnosticUtils";

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
  it("prefers diagnostic metadata", () => {
    const diagnostic = createDiagnostic({ code: "missing-agent" });
    setDiagnosticMetadata(diagnostic, { code: "missing-stages" });

    assert.equal(resolveDiagnosticCode(diagnostic), "missing-stages");
  });

  it("resolves string and object diagnostic codes from Jenkins diagnostics", () => {
    assert.equal(resolveDiagnosticCode(createDiagnostic({ code: "invalid-step" })), "invalid-step");
    assert.equal(
      resolveDiagnosticCode(createDiagnostic({ code: { value: "unknown-dsl-method" } })),
      "unknown-dsl-method"
    );
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
