import { JenkinsRequestError } from "../errors";
import { isAuthRedirect } from "../urls";

const MAX_REDIRECTS = 5;

function resolveRedirectLocation(
  location: string | string[] | undefined,
  baseUrl: string
): string | undefined {
  const rawLocation = Array.isArray(location) ? location.at(0) : location;
  if (!rawLocation) {
    return undefined;
  }
  try {
    return new URL(rawLocation, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export type RedirectDecision =
  | {
      type: "none";
    }
  | {
      type: "follow";
      nextUrl: string;
      redirectCount: number;
    }
  | {
      type: "cannotFollow";
    }
  | {
      type: "reject";
      error: JenkinsRequestError;
    };

export interface RedirectDecisionInput {
  statusCode: number;
  method: "GET" | "POST" | "HEAD";
  location: string | string[] | undefined;
  currentUrl: string;
  redirectCount: number;
}

export type RequestRedirectResolution =
  | {
      type: "reject";
      error: JenkinsRequestError;
    }
  | {
      type: "follow";
      nextUrl: string;
      redirectCount: number;
    }
  | {
      type: "continue";
    };

export function decideRedirect({
  statusCode,
  method,
  location,
  currentUrl,
  redirectCount
}: RedirectDecisionInput): RedirectDecision {
  if (statusCode < 300 || statusCode >= 400) {
    return { type: "none" };
  }

  const canFollowRedirect = method === "GET" || method === "HEAD";
  if (location === undefined) {
    if (canFollowRedirect) {
      return { type: "none" };
    }
    return {
      type: "reject",
      error: new JenkinsRequestError(
        "Jenkins returned a redirect without a location header.",
        statusCode
      )
    };
  }

  const nextUrl = resolveRedirectLocation(location, currentUrl);
  if (!nextUrl) {
    return {
      type: "reject",
      error: new JenkinsRequestError(
        "Jenkins returned an invalid redirect location header.",
        statusCode
      )
    };
  }

  if (isAuthRedirect(nextUrl, currentUrl)) {
    return {
      type: "reject",
      error: new JenkinsRequestError(
        "Jenkins redirected to login. Check credentials or CSRF settings.",
        statusCode
      )
    };
  }

  if (!canFollowRedirect) {
    return { type: "cannotFollow" };
  }

  if (redirectCount >= MAX_REDIRECTS) {
    return {
      type: "reject",
      error: new JenkinsRequestError("Too many redirects from Jenkins API.")
    };
  }

  return {
    type: "follow",
    nextUrl,
    redirectCount: redirectCount + 1
  };
}

export function resolveRequestRedirect(
  redirectDecision: RedirectDecision
): RequestRedirectResolution {
  if (redirectDecision.type === "reject") {
    return {
      type: "reject",
      error: redirectDecision.error
    };
  }
  if (redirectDecision.type === "follow") {
    return {
      type: "follow",
      nextUrl: redirectDecision.nextUrl,
      redirectCount: redirectDecision.redirectCount
    };
  }
  return { type: "continue" };
}
