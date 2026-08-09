const CONSOLE_ERROR_PREFIX = "console output:";

export function splitBuildDetailsErrors(errors: string[]): {
  consoleError?: string;
  displayErrors: string[];
} {
  let consoleError: string | undefined;
  const displayErrors: string[] = [];
  for (const error of errors) {
    if (!consoleError && error.toLowerCase().startsWith(CONSOLE_ERROR_PREFIX)) {
      consoleError = error.slice(CONSOLE_ERROR_PREFIX.length).trim() || undefined;
    } else {
      displayErrors.push(error);
    }
  }
  return { consoleError, displayErrors };
}
