import { JenkinsActionError } from "../jenkins/errors";

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

export function formatActionError(error: unknown): string {
  if (error instanceof JenkinsActionError) {
    return error.message;
  }
  return formatError(error);
}
