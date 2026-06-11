const CONSOLE_ERROR_PREFIX = "console output:";

export function splitBuildDetailsErrors(errors: string[]): {
  consoleError?: string;
  displayErrors: string[];
} {
  let consoleError: string | undefined;
  const displayErrors: string[] = [];
  for (const error of errors) {
    if (
      !consoleError &&
      typeof error === "string" &&
      error.toLowerCase().startsWith(CONSOLE_ERROR_PREFIX)
    ) {
      consoleError = error.replace(/^console output:\s*/i, "").trim();
    } else {
      displayErrors.push(error);
    }
  }
  if (consoleError && consoleError.length === 0) {
    consoleError = undefined;
  }
  return { consoleError, displayErrors };
}
