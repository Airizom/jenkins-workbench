import { JenkinsRequestError } from "../jenkins/errors";

// Failures that affect every request to an environment, not just the node that failed.
export type TreeEnvironmentIssueKind = "auth" | "unreachable";

export interface TreeLoadErrorPresentation {
  message: string;
  hint?: string;
  issue?: TreeEnvironmentIssueKind;
}

// Connection-level failures only: a request timeout or reset can come from one slow or large
// endpoint while the rest of the environment still responds.
const UNREACHABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT"
]);

export function describeTreeLoadError(error: unknown): TreeLoadErrorPresentation {
  const message = error instanceof Error && error.message ? error.message : "Unexpected error.";
  const issue = classifyTreeLoadError(error);
  switch (issue) {
    case "auth":
      return {
        message,
        issue,
        hint: "Check the saved credentials, or use Sign in with Browser SSO on the environment."
      };
    case "unreachable":
      return { message, issue, hint: "Check the Jenkins URL and your network connection." };
    default:
      return { message };
  }
}

export function formatEnvironmentIssueLabel(issue: TreeEnvironmentIssueKind): string {
  return issue === "auth" ? "Sign-in failed" : "Unreachable";
}

function classifyTreeLoadError(error: unknown): TreeEnvironmentIssueKind | undefined {
  if (isAuthError(error)) {
    return "auth";
  }
  return isUnreachableError(error) ? "unreachable" : undefined;
}

// A 403 for a signed-in user only means one permission is missing (for example Workspace), so
// it must not mark the whole environment. Jenkins flags unauthenticated 403s with this header.
function isAuthError(error: unknown): boolean {
  if (!(error instanceof JenkinsRequestError)) {
    return false;
  }
  if (error.statusCode === 401) {
    return true;
  }
  return (
    error.statusCode === 403 &&
    error.responseHeaders?.["x-you-are-authenticated-as"] === "anonymous"
  );
}

function isUnreachableError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && UNREACHABLE_ERROR_CODES.has(code);
}
