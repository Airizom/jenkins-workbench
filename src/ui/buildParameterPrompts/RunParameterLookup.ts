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
  const environmentOrigin = resolveOrigin(environment.url);
  const addCandidate = (candidate: string): void => {
    if (!isSameOrigin(candidate, environmentOrigin)) {
      return;
    }
    if (values.includes(candidate)) {
      return;
    }
    values.push(candidate);
  };

  const raw = parameter.runProjectName?.trim();
  if (raw && raw.length > 0) {
    let absolute: URL | undefined;
    try {
      absolute = new URL(raw);
    } catch {
      // Not an absolute URL.
    }

    if (absolute) {
      const candidate = ensureTrailingSlash(absolute.toString());
      if (parseJobUrl(candidate)) {
        addCandidate(candidate);
      }
    } else {
      try {
        const relative = ensureTrailingSlash(
          new URL(raw, ensureTrailingSlash(environment.url)).toString()
        );
        if (parseJobUrl(relative)) {
          addCandidate(relative);
        } else {
          const segments = raw
            .split("/")
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0);
          if (segments.length > 0) {
            addCandidate(
              segments.reduce(
                (parentUrl, segment) => buildJobUrl(parentUrl, segment),
                ensureTrailingSlash(environment.url)
              )
            );
          }
        }
      } catch {
        // Ignore invalid relative URL or job name.
      }
    }
  }

  // Keep current job as the final fallback so explicit runProjectName targets are preferred.
  addCandidate(currentJobUrl);

  return values;
}

function resolveOrigin(value: string): string | undefined {
  try {
    return new URL(ensureTrailingSlash(value)).origin;
  } catch {
    return undefined;
  }
}

function isSameOrigin(candidate: string, environmentOrigin: string | undefined): boolean {
  if (!environmentOrigin) {
    return false;
  }
  try {
    return new URL(candidate).origin === environmentOrigin;
  } catch {
    return false;
  }
}
