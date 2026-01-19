import { BuildActionError, JenkinsActionError, JenkinsRequestError } from "../errors";

type ActionErrorConstructor<T extends JenkinsActionError> = new (
  message: string,
  code: JenkinsActionError["code"],
  statusCode?: number
) => T;

const toActionError = <T extends JenkinsActionError>(
  error: unknown,
  ErrorType: ActionErrorConstructor<T>
): T => {
  if (error instanceof ErrorType) {
    return error;
  }

  if (error instanceof JenkinsRequestError) {
    if (error.statusCode === 403) {
      return new ErrorType(
        "Jenkins rejected the request (403). Check permissions or credentials.",
        "forbidden",
        error.statusCode
      );
    }
    if (error.statusCode === 404) {
      return new ErrorType(
        "The Jenkins endpoint was not found (404). The required plugin may be missing.",
        "not_found",
        error.statusCode
      );
    }
    if (error.statusCode && error.statusCode >= 300 && error.statusCode < 400) {
      if (error.message.toLowerCase().includes("redirected to login")) {
        return new ErrorType(
          "Jenkins redirected to login. Check credentials or CSRF settings.",
          "auth",
          error.statusCode
        );
      }
      return new ErrorType(error.message, "redirect", error.statusCode);
    }
    return new ErrorType(error.message, "unknown", error.statusCode);
  }

  return new ErrorType(
    error instanceof Error ? error.message : "Unexpected error.",
    "unknown"
  );
};

export const toBuildActionError = (error: unknown): BuildActionError =>
  toActionError(error, BuildActionError);

export const toJenkinsActionError = (error: unknown): JenkinsActionError =>
  toActionError(error, JenkinsActionError);
