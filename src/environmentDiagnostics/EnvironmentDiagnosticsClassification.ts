import type {
  EnvironmentProbeId,
  EnvironmentProbeResponse
} from "../jenkins/client/JenkinsEnvironmentDiagnosticsApi";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../jenkins/errors";
import type {
  DiagnosticCheck,
  DiagnosticCheckId,
  RecoveryAction
} from "./EnvironmentDiagnosticsContracts";

const diagnosticLabels: Record<DiagnosticCheckId, string> = {
  connectivity: "Connectivity and TLS",
  authentication: "Authentication",
  api: "Jenkins API access",
  queue: "Queue access",
  nodes: "Node access",
  csrf: "CSRF support",
  pipeline: "Pipeline syntax"
};

export const diagnosticFeatures: Record<DiagnosticCheckId, string> = {
  connectivity:
    "All Jenkins features require a reachable server. Check the hostname, network or VPN, and whether Jenkins is running.",
  authentication: "The current identity determines which jobs and actions Jenkins exposes.",
  api: "Job and view browsing require root API access. Empty results do not prove access to every job.",
  queue: "Queue browsing and following queued builds use this API.",
  nodes:
    "Node browsing, Node Capacity, and Node Details use this API. This does not verify node management permissions.",
  csrf: "Crumbs support CSRF-protected actions. This read-only check does not verify build-trigger or other write permissions.",
  pipeline:
    "Jenkinsfile language support uses Pipeline syntax metadata. This does not verify Declarative validation or job-specific Pipeline features."
};

export function diagnosticCheck(
  id: DiagnosticCheckId,
  status: DiagnosticCheck["status"],
  code: string,
  summary: string,
  actions: RecoveryAction[] = [],
  detail = diagnosticFeatures[id],
  evidence?: string[]
): DiagnosticCheck {
  return { id, label: diagnosticLabels[id], status, code, summary, detail, actions, evidence };
}

export function authRecovery(sso: boolean): RecoveryAction[] {
  return sso ? ["signIn", "editCredentials", "retry"] : ["editCredentials", "retry"];
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function isLoginResponse(response: EnvironmentProbeResponse): boolean {
  return (
    /<(?:html|form)\b/i.test(response.text) &&
    /(?:j_security_check|j_acegi_security_check|type\s*=\s*["']password["']|local sso session required|\/__sso\/login)/i.test(
      response.text
    )
  );
}

export function classifyProbeFailure(
  id: EnvironmentProbeId,
  error: unknown,
  sso: boolean
): DiagnosticCheck {
  if (error instanceof JenkinsMaxBytesError) {
    return diagnosticCheck(
      id,
      "unavailable",
      "responseTooLarge",
      "The response exceeded the diagnostic size limit.",
      ["retry", "openJenkins"]
    );
  }
  if (error instanceof JenkinsRequestError && error.message.includes("redirected to login")) {
    return diagnosticCheck(
      id,
      id === "authentication" || id === "api" ? "failed" : "unavailable",
      "loginRedirect",
      "Jenkins redirected the request to sign-in.",
      authRecovery(sso)
    );
  }
  const code = getErrorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return diagnosticCheck(
      id,
      "unavailable",
      "dns",
      "The Jenkins hostname could not be resolved.",
      ["editUrl", "retry"],
      "Check the hostname and network or VPN connection, then retry."
    );
  }
  if (code === "ECONNREFUSED") {
    return diagnosticCheck(
      id,
      "unavailable",
      "connectionRefused",
      "The server refused the connection.",
      ["editUrl", "retry"],
      "Check the Jenkins host and port, whether Jenkins is running, and firewall or VPN access."
    );
  }
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return diagnosticCheck(
      id,
      "unavailable",
      "timeout",
      "The Jenkins request timed out.",
      ["retry", "timeoutSettings", "editUrl"],
      "Check network or VPN access and server responsiveness. Increase the request timeout if this server is expected to respond slowly."
    );
  }
  if (code && /(?:CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER)/.test(code)) {
    return diagnosticCheck(
      id,
      "unavailable",
      "certificate",
      "TLS certificate verification failed.",
      ["tlsSettings", "editUrl", "retry"],
      "Check the certificate's hostname, validity, and issuing CA. Prefer a trusted certificate or CA; TLS Settings opens the existing explicit certificate-policy workflow."
    );
  }
  if (
    error instanceof JenkinsRequestError &&
    error.statusCode &&
    error.statusCode >= 300 &&
    error.statusCode < 400
  ) {
    return diagnosticCheck(
      id,
      "unavailable",
      "redirect",
      "The Jenkins endpoint returned an unusable redirect.",
      ["editUrl", "openJenkins", "retry"],
      "Check the Jenkins base URL, context path, and reverse-proxy routing.",
      [`HTTP ${error.statusCode}`]
    );
  }
  return diagnosticCheck(
    id,
    "unavailable",
    "transport",
    "The Jenkins request could not be completed.",
    ["retry", "editUrl"],
    "Check network or VPN access and reverse-proxy configuration. No complete response was available to verify this check."
  );
}

function classifyMissingEndpoint(id: EnvironmentProbeId, evidence: string[]): DiagnosticCheck {
  if (id === "api" || id === "authentication") {
    return diagnosticCheck(
      id,
      "failed",
      "notFound",
      "The Jenkins endpoint was not found.",
      ["editUrl", "openJenkins", "retry"],
      `${diagnosticFeatures[id]} Check the base URL and Jenkins context path.`,
      evidence
    );
  }
  const guidance =
    id === "csrf"
      ? "CSRF protection may be disabled, or the issuer may be hidden by permissions or a proxy. This does not establish whether writes require a crumb."
      : "The endpoint may be hidden by permissions or a proxy, or the capability may not be installed/enabled. Ask a Jenkins administrator to verify it.";
  return diagnosticCheck(
    id,
    "unavailable",
    "notFound",
    "This capability endpoint is unavailable.",
    ["openJenkins", "retry"],
    `${diagnosticFeatures[id]} ${guidance}`,
    evidence
  );
}

export function classifyHttpResponse(
  id: EnvironmentProbeId,
  response: EnvironmentProbeResponse,
  sso: boolean
): DiagnosticCheck | undefined {
  const evidence = [`HTTP ${response.statusCode}`];
  if (response.statusCode === 401 || isLoginResponse(response)) {
    return diagnosticCheck(
      id,
      id === "authentication" || id === "api" ? "failed" : "unavailable",
      "authenticationRequired",
      "Jenkins requires valid authentication.",
      authRecovery(sso),
      diagnosticFeatures[id],
      evidence
    );
  }
  if (response.statusCode === 403) {
    return diagnosticCheck(
      id,
      "unavailable",
      "forbidden",
      "Jenkins denied access to this endpoint.",
      [...(sso ? ["signIn" as const] : []), "editCredentials", "openJenkins", "retry"],
      `${diagnosticFeatures[id]} A 403 may indicate permissions, credentials, or a gateway restriction; it does not identify which one. Check the user's relevant read permissions and proxy policy.`,
      evidence
    );
  }
  if (response.statusCode === 404) {
    return classifyMissingEndpoint(id, evidence);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return diagnosticCheck(
      id,
      "unavailable",
      "httpError",
      "The server did not return a successful response.",
      ["retry", "openJenkins"],
      `${diagnosticFeatures[id]} Check server availability and gateway routing.`,
      evidence
    );
  }
  return undefined;
}

export function parseProbeJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function hasNamedEntries(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === "object" && item !== null && typeof item.name === "string"
    )
  );
}

export function validateCapabilityResponse(
  id: EnvironmentProbeId,
  response: EnvironmentProbeResponse
): boolean {
  if (id === "pipeline") {
    return (
      !/<(?:html|form)\b/i.test(response.text) &&
      /\bcontext\s*\(/.test(response.text) &&
      /\bcontributor\s*\(/.test(response.text)
    );
  }
  const json = parseProbeJson(response.text);
  if (!json) {
    return false;
  }
  switch (id) {
    case "api":
      return hasNamedEntries(json.jobs) && hasNamedEntries(json.views);
    case "authentication":
      return (
        typeof json.authenticated === "boolean" &&
        typeof json.anonymous === "boolean" &&
        typeof json.name === "string"
      );
    case "queue":
      return (
        Array.isArray(json.items) &&
        json.items.every(
          (item) => typeof item === "object" && item !== null && typeof item.id === "number"
        )
      );
    case "nodes":
      return (
        Array.isArray(json.computer) &&
        json.computer.every(
          (item) =>
            typeof item === "object" && item !== null && typeof item.displayName === "string"
        )
      );
    case "csrf":
      return (
        typeof json.crumbRequestField === "string" &&
        json.crumbRequestField.length > 0 &&
        typeof json.crumb === "string" &&
        json.crumb.length > 0
      );
  }
}
