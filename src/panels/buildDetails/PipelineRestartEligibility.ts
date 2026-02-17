import type { JenkinsBuildDetails } from "../../jenkins/types";

export function isPipelineRestartEligible(details?: JenkinsBuildDetails): boolean {
  if (!details || details.building) {
    return false;
  }
  const result = (details.result ?? "").trim().toUpperCase();
  return result === "FAILURE" || result === "UNSTABLE";
}
