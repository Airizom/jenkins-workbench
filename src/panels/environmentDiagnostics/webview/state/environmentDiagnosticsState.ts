import type {
  EnvironmentDiagnosticsOutgoingMessage,
  EnvironmentDiagnosticsViewModel
} from "../../shared/EnvironmentDiagnosticsPanelMessages";

export const emptyEnvironmentDiagnosticsState: EnvironmentDiagnosticsViewModel = {
  revision: 0,
  environmentLabel: "Jenkins",
  url: "",
  scope: "workspace",
  state: "idle",
  recovering: false
};

export function environmentDiagnosticsReducer(
  state: EnvironmentDiagnosticsViewModel,
  message: EnvironmentDiagnosticsOutgoingMessage
): EnvironmentDiagnosticsViewModel {
  return message.model.revision < state.revision ? state : message.model;
}

export function getInitialEnvironmentDiagnosticsState(): EnvironmentDiagnosticsViewModel {
  return (
    (window as unknown as { __INITIAL_STATE__?: EnvironmentDiagnosticsViewModel })
      .__INITIAL_STATE__ ?? emptyEnvironmentDiagnosticsState
  );
}

export function describeDiagnosticsOutcome(model: EnvironmentDiagnosticsViewModel): string {
  if (model.recovering) {
    return "Updating connection settings";
  }
  if (model.state === "running") {
    return "Checking environment";
  }
  if (model.state === "removed") {
    return "Environment removed";
  }
  if (model.state === "cancelled") {
    return "Checks cancelled";
  }
  if (!model.report) {
    return "Ready to test";
  }
  const checks = model.report.checks;
  if (checks.some((check) => check.status === "failed")) {
    return "Connection needs attention";
  }
  if (checks.some((check) => check.status === "warning" || check.status === "unavailable")) {
    const connectivity = checks.find((check) => check.id === "connectivity");
    return connectivity?.status === "passed" || connectivity?.status === "warning"
      ? "Connected with limitations"
      : "Some checks could not be verified";
  }
  return checks.length > 0 && checks.every((check) => check.status === "passed")
    ? "All checks passed"
    : "Some checks were skipped";
}
