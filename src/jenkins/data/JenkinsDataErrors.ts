import { BuildActionError, JenkinsRequestError } from "../errors";

export const toBuildActionError = (error: unknown): BuildActionError => {
  if (error instanceof BuildActionError) {
    return error;
  }

  if (error instanceof JenkinsRequestError) {
    if (error.statusCode === 403) {
      return new BuildActionError(
        "Jenkins rejected the request (403). Check permissions or credentials.",
        "forbidden",
        error.statusCode
      );
    }
    if (error.statusCode === 404) {
      return new BuildActionError(
        "The Jenkins endpoint was not found (404). The required plugin may be missing.",
        "not_found",
        error.statusCode
      );
    }
    if (error.statusCode && error.statusCode >= 300 && error.statusCode < 400) {
      if (error.message.toLowerCase().includes("redirected to login")) {
        return new BuildActionError(
          "Jenkins redirected to login. Check credentials or CSRF settings.",
          "auth",
          error.statusCode
        );
      }
      return new BuildActionError(error.message, "redirect", error.statusCode);
    }
    return new BuildActionError(error.message, "unknown", error.statusCode);
  }

  return new BuildActionError(
    error instanceof Error ? error.message : "Unexpected error.",
    "unknown"
  );
};
