import type { EnvironmentDiagnosticsViewModel } from "../../../src/panels/environmentDiagnostics/shared/EnvironmentDiagnosticsPanelMessages";

const success = {
  revision: 1,
  environmentLabel: "Production Jenkins",
  url: "https://jenkins.example.com/jenkins/",
  scope: "workspace",
  state: "completed",
  recovering: false,
  report: {
    runId: 1,
    startedAt: "2026-11-08T15:00:00.000Z",
    completedAt: "2026-11-08T15:00:01.000Z",
    jenkinsVersion: "2.541.3",
    checks: [
      {
        id: "connectivity",
        label: "Connectivity and TLS",
        status: "passed",
        code: "reachable",
        summary: "Jenkins is reachable.",
        detail: "The server responded over HTTPS with certificate verification enabled.",
        evidence: ["HTTP 200"],
        actions: []
      },
      {
        id: "authentication",
        label: "Authentication",
        status: "passed",
        code: "authenticated",
        summary: "Authenticated as build-engineer.",
        detail: "Jenkins recognized the configured credentials.",
        actions: []
      },
      {
        id: "api",
        label: "Jenkins API access",
        status: "passed",
        code: "api_accessible",
        summary: "Jobs and views API is accessible.",
        detail: "Tree browsing is available. Individual jobs may require additional permissions.",
        actions: []
      },
      {
        id: "queue",
        label: "Queue access",
        status: "passed",
        code: "accessible",
        summary: "Queue API is accessible.",
        detail: "Queue visibility is available.",
        actions: []
      },
      {
        id: "nodes",
        label: "Node access",
        status: "passed",
        code: "accessible",
        summary: "Node API is accessible.",
        detail: "Node browsing and capacity views can retrieve node information.",
        actions: []
      },
      {
        id: "csrf",
        label: "CSRF support",
        status: "passed",
        code: "crumb_available",
        summary: "A CSRF crumb is available.",
        detail:
          "Crumb availability does not verify permission to trigger builds or modify Jenkins.",
        actions: []
      },
      {
        id: "pipeline",
        label: "Pipeline syntax",
        status: "passed",
        code: "syntax_available",
        summary: "Pipeline syntax is accessible.",
        detail: "Jenkinsfile language support can retrieve Pipeline syntax metadata.",
        actions: []
      }
    ]
  }
} satisfies EnvironmentDiagnosticsViewModel;

export const environmentDiagnosticsScenarios: Record<string, EnvironmentDiagnosticsViewModel> = {
  success,
  restricted: {
    ...success,
    report: {
      ...success.report,
      checks: success.report.checks.map((check) =>
        check.id === "nodes"
          ? {
              ...check,
              status: "unavailable",
              code: "forbidden",
              summary: "Jenkins denied access to the node API.",
              detail:
                "Node browsing and capacity views may be unavailable. Ask your administrator to check permissions.",
              actions: ["editCredentials", "openJenkins"],
              evidence: ["HTTP 403"]
            }
          : check
      )
    }
  },
  authenticationFailed: {
    ...success,
    report: {
      ...success.report,
      checks: [
        {
          id: "authentication",
          label: "Authentication",
          status: "failed",
          code: "authentication_required",
          summary: "The Browser SSO session is no longer accepted.",
          detail: "Sign in again to verify authenticated API access.",
          actions: ["signIn", "editCredentials"],
          evidence: ["HTTP 401"]
        }
      ]
    }
  },
  running: {
    ...success,
    state: "running",
    report: {
      ...success.report,
      completedAt: undefined,
      checks: success.report.checks.slice(0, 2)
    }
  },
  cancelled: {
    ...success,
    state: "cancelled",
    notice: "Checks cancelled. Any completed checks are shown below.",
    report: {
      ...success.report,
      completedAt: undefined,
      checks: success.report.checks.slice(0, 2)
    }
  },
  removed: {
    ...success,
    state: "removed",
    report: undefined,
    notice: "This environment was removed. Add or select an environment to run checks."
  }
};
