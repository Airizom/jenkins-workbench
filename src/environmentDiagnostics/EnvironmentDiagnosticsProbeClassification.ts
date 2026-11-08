import type {
  EnvironmentProbeId,
  EnvironmentProbeResponse
} from "../jenkins/client/JenkinsEnvironmentDiagnosticsApi";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import {
  authRecovery,
  classifyHttpResponse,
  classifyProbeFailure,
  diagnosticCheck,
  diagnosticFeatures,
  parseProbeJson,
  validateCapabilityResponse
} from "./EnvironmentDiagnosticsClassification";
import type { DiagnosticCheck } from "./EnvironmentDiagnosticsContracts";

export type ProbeOutcome = { response: EnvironmentProbeResponse } | { error: unknown };
export interface DiagnosticAuthContext {
  sso: boolean;
  hasCredentials: boolean;
  secrets: string[];
}

function safeIdentity(value: unknown, secrets: string[]): string | undefined {
  if (typeof value !== "string" || !/^[\p{L}\p{N}_.@ -]{1,120}$/u.test(value)) {
    return undefined;
  }
  return secrets.some((secret) => secret.length > 0 && value.includes(secret)) ? undefined : value;
}

function classifyIdentity(
  response: EnvironmentProbeResponse,
  auth: DiagnosticAuthContext
): DiagnosticCheck {
  const json = parseProbeJson(response.text);
  if (json?.anonymous !== true && json?.authenticated === true) {
    const name = safeIdentity(json.name, auth.secrets);
    return diagnosticCheck(
      "authentication",
      "passed",
      "authenticated",
      name ? `Authenticated as ${name}.` : "Jenkins reports an authenticated identity.",
      [],
      diagnosticFeatures.authentication,
      [`HTTP ${response.statusCode}`]
    );
  }
  if (json?.anonymous !== true) {
    return diagnosticCheck(
      "authentication",
      "unavailable",
      "identityUnverified",
      "Jenkins did not report an authenticated or anonymous identity.",
      authRecovery(auth.sso),
      diagnosticFeatures.authentication,
      [`HTTP ${response.statusCode}`]
    );
  }
  return diagnosticCheck(
    "authentication",
    auth.hasCredentials ? "warning" : "passed",
    "anonymous",
    auth.hasCredentials
      ? "Jenkins reports anonymous access despite configured credentials."
      : "Anonymous access is available as configured.",
    auth.hasCredentials ? authRecovery(auth.sso) : [],
    auth.hasCredentials
      ? "Check the credentials or sign-in session. A readable root API does not establish that configured credentials were accepted."
      : diagnosticFeatures.authentication,
    [`HTTP ${response.statusCode}`]
  );
}

export function classifyProbeOutcome(
  id: EnvironmentProbeId,
  outcome: ProbeOutcome,
  auth: DiagnosticAuthContext
): DiagnosticCheck {
  if ("error" in outcome) {
    return classifyProbeFailure(id, outcome.error, auth.sso);
  }
  const { response } = outcome;
  const failure = classifyHttpResponse(id, response, auth.sso);
  if (failure) {
    return failure;
  }
  if (!validateCapabilityResponse(id, response)) {
    return diagnosticCheck(
      id,
      "unavailable",
      "unexpectedResponse",
      "The endpoint returned an unexpected response.",
      ["editUrl", "openJenkins", "retry"],
      `${diagnosticFeatures[id]} Check the context path and whether a login page or gateway intercepted the request. No complete, recognizable capability response was verified.`,
      [`HTTP ${response.statusCode}`]
    );
  }
  if (id === "authentication") {
    return classifyIdentity(response, auth);
  }
  return diagnosticCheck(
    id,
    "passed",
    "available",
    id === "csrf" ? "A CSRF crumb is available." : "The expected endpoint is accessible.",
    [],
    diagnosticFeatures[id],
    [`HTTP ${response.statusCode}`]
  );
}

export function buildConnectivityCheck(ref: JenkinsEnvironmentRef): DiagnosticCheck {
  if (ref.allowInsecureTls) {
    return diagnosticCheck(
      "connectivity",
      "warning",
      "tlsVerificationDisabled",
      "The server is reachable with TLS verification disabled.",
      ["tlsSettings"],
      "The saved certificate exception was used. Re-enable verification after fixing the certificate or trusted CA. HTTP responses, including authentication failures, establish connectivity."
    );
  }
  return diagnosticCheck(
    "connectivity",
    "passed",
    "reachable",
    "The server is reachable.",
    [],
    ref.url.startsWith("https:")
      ? "A response was received using the saved TLS policy. HTTP authentication or permission failures do not mean the server is unreachable."
      : "A response was received over HTTP; TLS is not used for this environment."
  );
}
