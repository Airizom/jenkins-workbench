import type { JenkinsAuthConfig } from "../jenkins/types";
import { getUrlOrigin, stripUrlCredentials } from "../jenkins/urls";

/**
 * How a server expects to be signed in to, without anything secret. Stored records persist it
 * (kept in step with the auth config); settings declarations state it. Pure: no `vscode` import.
 */
export type EnvironmentAuthHint =
  | { type: "none" }
  | { type: "basic" }
  | { type: "bearer" }
  | { type: "sso"; loginUrl: string };

/**
 * The non-secret hint describing how an auth config signs in, used for stored records and for
 * shared declarations alike. Credentials embedded in an SSO sign-in URL are removed; the hint is
 * dropped when the result is not a valid http(s) URL. Cookie and custom-header auth have no hint:
 * another machine could not reproduce them from one.
 */
export function toEnvironmentAuthHint(
  authConfig: JenkinsAuthConfig
): EnvironmentAuthHint | undefined {
  switch (authConfig.type) {
    case "none":
    case "basic":
    case "bearer":
      return { type: authConfig.type };
    case "sso": {
      const loginUrl = parseLoginUrl(stripUrlCredentials(authConfig.loginUrl));
      return loginUrl ? { type: "sso", loginUrl } : undefined;
    }
    default:
      return undefined;
  }
}

export function areAuthHintsEqual(
  left: EnvironmentAuthHint | undefined,
  right: EnvironmentAuthHint | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  if (left.type === "sso" && right.type === "sso") {
    return left.loginUrl === right.loginUrl;
  }
  return left.type === right.type;
}

/** The SSO sign-in page origin when it differs from the server origin; otherwise undefined. */
export function getSeparateLoginOrigin(
  url: string,
  authHint: EnvironmentAuthHint | undefined
): string | undefined {
  if (authHint?.type !== "sso") {
    return undefined;
  }
  const loginOrigin = getUrlOrigin(authHint.loginUrl);
  return loginOrigin && loginOrigin !== getUrlOrigin(url) ? loginOrigin : undefined;
}

/**
 * What a user confirms before a shared environment is used: the server origin, plus
 * `|<sign-in page origin>` when an SSO hint sends the browser to another origin. Undefined when
 * the URL does not parse.
 */
export function toOriginAcknowledgment(
  url: string,
  authHint: EnvironmentAuthHint | undefined
): string | undefined {
  const origin = getUrlOrigin(url);
  if (!origin) {
    return undefined;
  }
  const loginOrigin = getSeparateLoginOrigin(url, authHint);
  return loginOrigin ? `${origin}|${loginOrigin}` : origin;
}

/** Splits a value from `toOriginAcknowledgment` into its server and sign-in page origins. */
export function parseOriginAcknowledgment(value: string): {
  serverOrigin: string;
  loginOrigin?: string;
} {
  const separator = value.indexOf("|");
  return separator < 0
    ? { serverOrigin: value }
    : { serverOrigin: value.slice(0, separator), loginOrigin: value.slice(separator + 1) };
}

/** An http(s) sign-in URL without credentials, normalized; undefined otherwise. */
export function parseLoginUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}
