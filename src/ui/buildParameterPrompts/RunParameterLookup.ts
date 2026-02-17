import type { JobParameter } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { buildJobUrl, ensureTrailingSlash, parseJobUrl } from "../../jenkins/urls";
import type { BuildParameterPromptOptions } from "./BuildParameterPromptTypes";

export async function fetchRunBuildChoices(
  options: BuildParameterPromptOptions,
  parameter: JobParameter
): Promise<Array<{ number: number; description?: string; detail?: string }>> {
  const candidates = resolveRunJobCandidates(options.environment, options.jobUrl, parameter);

  for (const candidate of candidates) {
    try {
      const builds = await options.dataService.getBuildsForJob(options.environment, candidate, 20);
      const mapped = builds
        .filter((build) => typeof build.number === "number")
        .map((build) => ({
          number: build.number,
          description:
            typeof build.result === "string" && build.result.trim().length > 0
              ? build.result
              : undefined,
          detail:
            typeof build.timestamp === "number" && Number.isFinite(build.timestamp)
              ? new Date(build.timestamp).toLocaleString()
              : undefined
        }));
      if (mapped.length > 0) {
        return mapped;
      }
    } catch {
      // Fall back to manual input if lookups fail.
    }
  }

  return [];
}

function resolveRunJobCandidates(
  environment: JenkinsEnvironmentRef,
  currentJobUrl: string,
  parameter: JobParameter
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string): void => {
    if (seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    values.push(candidate);
  };

  const raw = parameter.runProjectName?.trim();
  if (raw && raw.length > 0) {
    try {
      const asUrl = new URL(raw);
      addCandidate(ensureTrailingSlash(asUrl.toString()));
    } catch {
      // Not an absolute URL.
    }

    try {
      const relative = new URL(raw, ensureTrailingSlash(environment.url));
      addCandidate(ensureTrailingSlash(relative.toString()));
    } catch {
      // Ignore invalid relative URL.
    }

    const segments = raw
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== "job");
    if (segments.length > 0) {
      const base = ensureTrailingSlash(environment.url);
      const parts = segments.map((segment) => `job/${encodeURIComponent(segment)}`).join("/");
      try {
        addCandidate(new URL(`${parts}/`, base).toString());
      } catch {
        // Ignore invalid composed candidate.
      }

      const parsedCurrent = parseJobUrl(currentJobUrl);
      if (parsedCurrent && segments.length === 1) {
        addCandidate(buildJobUrl(parsedCurrent.parentUrl, segments[0]));
      }
    }
  }

  // Keep current job as the final fallback so explicit runProjectName targets are preferred.
  addCandidate(currentJobUrl);

  return values;
}
