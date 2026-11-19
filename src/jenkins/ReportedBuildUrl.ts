import { resolveBuildIdentityForEnvironment, resolveLiteralBuildZeroUrl } from "./urls";

/** Convert a build URL supplied by Jenkins before opening or matching a panel on the configured controller. */
export function reportedBuildDetailsUrl(environmentUrl: string, url: string): string;
export function reportedBuildDetailsUrl(
  environmentUrl: string,
  url: string,
  buildNumber: number | undefined
): string | undefined;
export function reportedBuildDetailsUrl(
  environmentUrl: string,
  url: string,
  buildNumber?: number
): string | undefined {
  if (buildNumber === 0) return resolveLiteralBuildZeroUrl(environmentUrl, url, "reported");
  const knownRun = buildNumber === undefined ? undefined : { buildNumber };
  const identity = resolveBuildIdentityForEnvironment(
    environmentUrl,
    url,
    "request",
    knownRun,
    "reported"
  );
  if (buildNumber === undefined) return identity?.buildUrl ?? url;
  return identity?.buildNumber === buildNumber ? identity.buildUrl : undefined;
}

/** Resolve the advertised URL and expected number together before using a numbered tree row. */
export function getTreeBuildDetailsUrl(item: {
  environment: { url: string };
  buildUrl: string;
  buildNumber?: number;
}): string | undefined {
  return reportedBuildDetailsUrl(item.environment.url, item.buildUrl, item.buildNumber);
}
