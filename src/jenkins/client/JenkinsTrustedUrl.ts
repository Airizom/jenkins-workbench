import { JenkinsRequestError } from "../errors";

export function resolveTrustedJenkinsUrl(
  trustedBaseUrl: string,
  candidateUrl: string,
  relativeTo: string
): string {
  try {
    const trustedOrigin = new URL(trustedBaseUrl).origin;
    const resolvedUrl = new URL(candidateUrl, relativeTo);
    if (resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:") {
      throw new JenkinsRequestError("Jenkins returned a URL with an unsupported protocol.");
    }
    if (resolvedUrl.origin !== trustedOrigin) {
      throw new JenkinsRequestError("Jenkins returned a URL for an untrusted origin.");
    }
    return resolvedUrl.toString();
  } catch (error) {
    if (error instanceof JenkinsRequestError) {
      throw error;
    }
    throw new JenkinsRequestError("Jenkins returned an invalid action URL.");
  }
}
