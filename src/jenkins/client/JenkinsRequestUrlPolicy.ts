import { JenkinsRequestError } from "../errors";

export function parseJenkinsBaseOrigin(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new JenkinsRequestError("Jenkins base URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new JenkinsRequestError("Jenkins base URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new JenkinsRequestError("Jenkins base URL must not contain embedded credentials.");
  }
  return parsed.origin;
}

export function assertTrustedJenkinsRequestUrl(url: string, baseOrigin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new JenkinsRequestError("Refusing to send Jenkins credentials to an invalid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new JenkinsRequestError("Refusing to send Jenkins credentials over this protocol.");
  }
  if (parsed.username || parsed.password) {
    throw new JenkinsRequestError("Refusing a Jenkins request URL with embedded credentials.");
  }
  if (parsed.origin !== baseOrigin) {
    throw new JenkinsRequestError("Refusing to send Jenkins credentials to an untrusted origin.");
  }
}
