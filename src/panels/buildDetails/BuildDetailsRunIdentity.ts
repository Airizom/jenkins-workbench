import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { resolvePermalinkBuildIdentity } from "../../jenkins/PermalinkBuildUrl";
import { isJenkinsBuildPermalink, type JenkinsBuildDetails } from "../../jenkins/types";
import {
  normalizeJenkinsUrlForComparison,
  resolveBuildIdentityForEnvironment,
  resolveLiteralBuildZeroUrl
} from "../../jenkins/urls";
import { isBuildQueueId } from "../../shared/build/BuildCompletionEvidence";

/** Identify a numbered panel endpoint that returned details for a different run. */
export function mismatchedPanelRunUrl(
  environment: JenkinsEnvironmentRef,
  panelUrl: string | undefined,
  observedNumber: number
): string | undefined {
  if (!panelUrl) return undefined;
  const requested = normalizeJenkinsUrlForComparison(panelUrl, environment.url);
  const match = requested.match(/\/(\d+)\/$/);
  if (!match) return undefined;
  const buildNumber = Number(match[1]);
  if (!Number.isSafeInteger(buildNumber) || buildNumber === observedNumber) return undefined;
  if (requested.startsWith(normalizeJenkinsUrlForComparison(environment.url))) return requested;
  return (
    resolveBuildIdentityForEnvironment(environment.url, requested, "request", { buildNumber })
      ?.buildUrl ?? requested
  );
}

/** Pin a known permalink using its configured job path and the returned run number. */
export function requestedPanelRun(
  environmentUrl: string,
  panelUrl: string | undefined,
  number: number,
  purpose: "request" | "comparison" | "share",
  reportedUrl?: string
) {
  if (!panelUrl || !Number.isSafeInteger(number) || number <= 0) return undefined;
  const requested = normalizeJenkinsUrlForComparison(panelUrl, environmentUrl);
  if (!requested.startsWith(normalizeJenkinsUrlForComparison(environmentUrl))) return undefined;
  const lastSegment = requested.split("/").at(-2);
  if (lastSegment && isJenkinsBuildPermalink(lastSegment)) {
    return resolvePermalinkBuildIdentity(
      environmentUrl,
      new URL("../", requested).href,
      number,
      reportedUrl,
      purpose
    );
  }
  // Only a directly supplied numbered URL can corroborate an opaque plugin route.
  return resolveBuildIdentityForEnvironment(
    environmentUrl,
    requested,
    purpose,
    { buildNumber: number },
    "configured"
  );
}

/** Resolve the displayed run for sharing and actions that also support legacy build zero. */
export function resolveDisplayedRun(
  environment: JenkinsEnvironmentRef | undefined,
  panelUrl: string | undefined,
  details: JenkinsBuildDetails | undefined,
  purpose: "request" | "comparison" | "share" = "request"
) {
  if (
    !environment ||
    !panelUrl ||
    !details ||
    mismatchedPanelRunUrl(environment, panelUrl, details.number)
  )
    return undefined;
  if (details.number === 0) {
    const buildUrl = resolveLiteralBuildZeroUrl(environment.url, panelUrl, "configured");
    return buildUrl ? { buildUrl, buildNumber: 0, label: "#0" } : undefined;
  }
  const identity =
    requestedPanelRun(environment.url, panelUrl, details.number, purpose, details.url) ??
    (details.url &&
      resolveBuildIdentityForEnvironment(environment.url, details.url, purpose, {
        buildNumber: details.number
      }));
  return identity && identity.buildNumber === details.number ? identity : undefined;
}

/** Bound to a numbered Jenkins Run, including any queue identity its response supplies. */
export interface PanelRunTarget {
  buildNumber: number;
  buildUrl: string;
  queueId?: number;
  result?: string;
}

export function resolvePanelRunTarget(
  environment: JenkinsEnvironmentRef | undefined,
  panelUrl: string | undefined,
  details: JenkinsBuildDetails | undefined
): PanelRunTarget | undefined {
  if (!details) return undefined;
  const identity = resolveDisplayedRun(environment, panelUrl, details);
  return (
    identity && {
      buildUrl: identity.buildUrl,
      buildNumber: identity.buildNumber,
      queueId: isBuildQueueId(details.queueId) ? details.queueId : undefined,
      result: details.result
    }
  );
}
