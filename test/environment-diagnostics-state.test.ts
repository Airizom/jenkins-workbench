import { describe, expect, it } from "vitest";
import type {
  DiagnosticCheck,
  DiagnosticStatus
} from "../src/environmentDiagnostics/EnvironmentDiagnosticsContracts";
import {
  type EnvironmentDiagnosticsViewModel,
  isRecoveryAction,
  parseEnvironmentDiagnosticsIncomingMessage,
  parseEnvironmentDiagnosticsOutgoingMessage
} from "../src/panels/environmentDiagnostics/shared/EnvironmentDiagnosticsPanelMessages";
import {
  describeDiagnosticsOutcome,
  emptyEnvironmentDiagnosticsState,
  environmentDiagnosticsReducer
} from "../src/panels/environmentDiagnostics/webview/state/environmentDiagnosticsState";

const model: EnvironmentDiagnosticsViewModel = {
  ...emptyEnvironmentDiagnosticsState,
  revision: 2,
  state: "completed",
  report: { runId: 1, startedAt: "2026-11-08T15:00:00Z", checks: [] }
};

describe("diagnostics messages and state", () => {
  it("accepts allowlisted actions without client-controlled environment targets", () => {
    expect(
      parseEnvironmentDiagnosticsIncomingMessage({
        type: "recover",
        action: "editUrl",
        url: "https://attacker.example"
      })
    ).toEqual({ type: "recover", action: "editUrl" });
    for (const value of [
      undefined,
      null,
      {},
      { type: "recover", action: "__proto__" },
      { type: "recover", action: "deleteEnvironment" },
      { type: "runCommand", command: "anything" }
    ]) {
      expect(parseEnvironmentDiagnosticsIncomingMessage(value)).toBeUndefined();
    }
    expect(isRecoveryAction("toString")).toBe(false);
    expect(isRecoveryAction("signIn")).toBe(true);
  });

  it("rejects malformed update envelopes and stale revisions", () => {
    expect(
      parseEnvironmentDiagnosticsOutgoingMessage({ type: "updateEnvironmentDiagnostics", model })
    ).toEqual({ type: "updateEnvironmentDiagnostics", model });
    expect(
      parseEnvironmentDiagnosticsOutgoingMessage({
        type: "updateEnvironmentDiagnostics",
        model: { ...model, revision: Number.NaN }
      })
    ).toBeUndefined();
    expect(
      parseEnvironmentDiagnosticsOutgoingMessage({
        type: "updateEnvironmentDiagnostics",
        model: { ...model, state: "unknown" }
      })
    ).toBeUndefined();
    expect(
      environmentDiagnosticsReducer(model, {
        type: "updateEnvironmentDiagnostics",
        model: { ...model, revision: 1, state: "running" }
      })
    ).toBe(model);
    expect(
      environmentDiagnosticsReducer(model, {
        type: "updateEnvironmentDiagnostics",
        model: { ...model, revision: 3, state: "cancelled" }
      }).state
    ).toBe("cancelled");
  });

  it("keeps cancellation and recovery separate from check results", () => {
    expect(describeDiagnosticsOutcome({ ...model, recovering: true })).toBe(
      "Updating connection settings"
    );
    expect(describeDiagnosticsOutcome({ ...model, state: "running" })).toBe("Checking environment");
    expect(describeDiagnosticsOutcome({ ...model, state: "cancelled" })).toBe("Checks cancelled");
    expect(describeDiagnosticsOutcome({ ...model, state: "removed" })).toBe("Environment removed");
    expect(describeDiagnosticsOutcome(emptyEnvironmentDiagnosticsState)).toBe("Ready to test");
  });
  it("requires connectivity evidence before describing limitations as connected", () => {
    const check = (id: DiagnosticCheck["id"], status: DiagnosticStatus): DiagnosticCheck => ({
      id,
      status,
      code: "test",
      label: id,
      summary: "Result",
      detail: "Details",
      actions: []
    });
    const outcome = (checks: DiagnosticCheck[]) =>
      describeDiagnosticsOutcome({
        ...model,
        report: { runId: 1, startedAt: "2026-11-08T15:00:00Z", checks }
      });
    expect(
      outcome([check("connectivity", "skipped"), check("authentication", "unavailable")])
    ).toBe("Some checks could not be verified");
    expect(outcome([check("authentication", "unavailable")])).toBe(
      "Some checks could not be verified"
    );
    expect(outcome([check("connectivity", "passed"), check("nodes", "unavailable")])).toBe(
      "Connected with limitations"
    );
    expect(outcome([check("connectivity", "warning")])).toBe("Connected with limitations");
    expect(outcome([check("connectivity", "failed")])).toBe("Connection needs attention");
    expect(outcome([check("connectivity", "passed")])).toBe("All checks passed");
    expect(outcome([check("connectivity", "skipped")])).toBe("Some checks were skipped");
    expect(outcome([])).toBe("Some checks were skipped");
  });
});
