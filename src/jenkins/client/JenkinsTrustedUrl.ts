import { JenkinsRequestError } from "../errors";
import { assertTrustedJenkinsRequestUrl, parseJenkinsBaseOrigin } from "./JenkinsRequestUrlPolicy";

export function resolveTrustedJenkinsUrl(
  trustedBaseUrl: string,
  candidateUrl: string,
  relativeTo: string
): string {
  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(candidateUrl, relativeTo);
  } catch {
    throw new JenkinsRequestError("Jenkins returned an invalid action URL.");
  }

  const trustedOrigin = parseJenkinsBaseOrigin(trustedBaseUrl);
  assertTrustedJenkinsRequestUrl(resolvedUrl.toString(), trustedOrigin);
  return resolvedUrl.toString();
}
