import type { JenkinsBuildAction, JenkinsBuildDetails } from "../types";

export function resolveCoverageActionPath(details: JenkinsBuildDetails | undefined): string {
  const coverageActions = getCoverageBuildActions(details);
  if (coverageActions.length === 0) {
    return "coverage";
  }

  const defaultAction = coverageActions.find((action) => action.urlName?.trim() === "coverage");
  return defaultAction?.urlName?.trim() ?? coverageActions[0].urlName?.trim() ?? "coverage";
}

export function hasCoverageAction(details: JenkinsBuildDetails | undefined): boolean {
  return getCoverageBuildActions(details).length > 0;
}

function getCoverageBuildActions(
  details: JenkinsBuildDetails | undefined
): Array<Extract<JenkinsBuildAction, { urlName?: string }>> {
  return (details?.actions ?? []).filter(isCoverageBuildAction);
}

function isCoverageBuildAction(
  action: JenkinsBuildAction | null | undefined
): action is Extract<JenkinsBuildAction, { urlName?: string }> {
  if (!action || typeof action !== "object") {
    return false;
  }
  const urlName = action.urlName?.trim();
  if (!urlName) {
    return false;
  }
  const className = action._class?.trim().toLowerCase() ?? "";
  return className.includes("coverage");
}
