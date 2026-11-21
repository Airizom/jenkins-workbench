const TESTS_TAB_HINT = "Detailed case results are available in the Tests tab.";

const REPORT_UNAVAILABLE_MESSAGE =
  "The test report could not be loaded, so individual test results are unavailable.";

const NO_DETAILS_MESSAGE = "Individual test results are not available for this build.";

/**
 * Only points at the Tests tab when that tab exists, and says so plainly when
 * the report itself failed to load instead of promising results elsewhere.
 */
export function describeTestsSummaryHint({
  hint,
  hasTestsTab,
  reportUnavailable
}: {
  hint?: string;
  hasTestsTab: boolean;
  reportUnavailable: boolean;
}): string {
  if (reportUnavailable) {
    return REPORT_UNAVAILABLE_MESSAGE;
  }
  if (!hasTestsTab) {
    return NO_DETAILS_MESSAGE;
  }
  return hint ?? TESTS_TAB_HINT;
}
