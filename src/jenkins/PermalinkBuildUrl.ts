import { resolveBuildReferenceUrl } from "./BuildReferenceParser";
import { isJenkinsBuildPermalink } from "./types";
import {
  isProjectChildSegment,
  normalizeJenkinsUrlForComparison,
  resolveBuildIdentityForEnvironment,
  resolveClassicJobPath,
  resolveLiteralBuildZeroUrl
} from "./urls";

/** A permalink supplies both a run number and its advertised URL. A custom
 * endpoint below the requested job can be authoritative even when /job/name/N
 * would also identify a build. An unrelated job's N cannot replace it. */
export function resolvePermalinkBuildIdentity(
  environmentUrl: string,
  jobUrl: string,
  number: number,
  reportedUrl: string | undefined,
  purpose: "request" | "comparison" | "share" = "request"
) {
  if (!Number.isSafeInteger(number) || number <= 0) return undefined;
  const base = normalizeJenkinsUrlForComparison(environmentUrl);
  const job = normalizeJenkinsUrlForComparison(jobUrl, environmentUrl);
  const known = { buildNumber: number };
  const configured = (url: string, mode = purpose, corroborated = true) =>
    resolveBuildIdentityForEnvironment(
      environmentUrl,
      url,
      mode,
      corroborated ? known : undefined,
      "configured"
    );
  let pinned = configured(`${job}${number}/`, purpose, false);
  if (!pinned && job.startsWith(base) && isExactJobReference(job, environmentUrl))
    pinned = configured(`${job}${number}/`);
  if (!reportedUrl) return pinned;

  const literal = normalizeJenkinsUrlForComparison(reportedUrl, environmentUrl);
  if (
    literal.startsWith(base) &&
    literal.endsWith(`/${number}/`) &&
    jobRunLocation(environmentUrl, job, literal) === "action"
  ) {
    const run = configured(literal);
    if (run?.buildNumber === number) return run;
  }
  if (pinned) return pinned;
  const advertised = resolveBuildIdentityForEnvironment(
    environmentUrl,
    reportedUrl,
    purpose,
    known
  );
  return advertised?.buildNumber === number ? advertised : undefined;
}

function isExactJobReference(job: string, environmentUrl: string): boolean {
  // A named job can live below a plugin/servlet prefix with numeric grouping pages.
  const parsed = resolveBuildReferenceUrl(new URL(job), environmentUrl);
  const owner = parsed.kind === "candidates" ? parsed.fallback : parsed;
  return owner?.kind === "job" && owner.jobUrl === job;
}

/** Unlike a normal permalink, zero can only be opened at a reported literal endpoint. */
export function resolvePermalinkBuildZeroUrl(
  environmentUrl: string,
  jobUrl: string,
  reportedUrl?: string
) {
  if (!reportedUrl) return undefined;
  const literal = resolveLiteralBuildZeroUrl(environmentUrl, reportedUrl, "reported");
  if (!literal) return undefined;
  const job = normalizeJenkinsUrlForComparison(jobUrl, environmentUrl);
  return jobRunLocation(environmentUrl, job, literal) ? literal : undefined;
}

function jobRunLocation(
  environmentUrl: string,
  job: string,
  literal: string
): "direct" | "action" | undefined {
  if (!job.startsWith(normalizeJenkinsUrlForComparison(environmentUrl))) return undefined;
  let parent = job;
  if (!literal.startsWith(parent)) {
    // The request and the report can use different classic views of the same job.
    const requested = classicJobOwner(environmentUrl, job);
    const reported = classicJobOwner(environmentUrl, literal);
    if (!requested || requested.url !== job || !reported || requested.key !== reported.key)
      return undefined;
    parent = reported.url;
  }
  const suffix = literal.slice(parent.length).split("/").filter(Boolean);
  if (suffix.length === 1) return "direct";
  const action = suffix.slice(0, -1);
  if (
    action.length &&
    !/^\d+$/.test(action[0]) &&
    !isProjectChildSegment(action[0]) &&
    !action.some(
      (segment) =>
        ["job", "artifact", "ws", "queue", "api"].includes(segment) ||
        isJenkinsBuildPermalink(segment)
    )
  )
    return "action";
  return undefined;
}

function classicJobOwner(environmentUrl: string, endpoint: string) {
  const url = new URL(endpoint);
  const parts = url.pathname.split("/").filter(Boolean);
  const classic = resolveClassicJobPath(url.origin, parts, environmentUrl, "configured");
  if (!classic) return undefined;
  const segment = parts[classic.jobEnd];
  const child = segment && isProjectChildSegment(segment) ? decodeURIComponent(segment) : undefined;
  const end = classic.jobEnd + (child ? 1 : 0);
  return {
    url: `${url.origin}/${parts.slice(0, end).join("/")}/`,
    key: JSON.stringify([classic.segments, child])
  };
}
