import type { JobParameter } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { buildJobUrl, ensureTrailingSlash, parseJobUrl } from "../../jenkins/urls";
import type { ParameterValuePromptContext } from "./BuildParameterPromptTypes";

export async function fetchRunBuildChoices(
  options: ParameterValuePromptContext,
  parameter: JobParameter
): Promise<Array<{ number: number; runId: string; description?: string; detail?: string }>> {
  const jobUrl = resolveRunJobUrl(options.environment, options.jobUrl, parameter);
  const job = jobUrl ? parseJobUrl(jobUrl, options.environment.url) : undefined;
  if (!jobUrl || !job) {
    return [];
  }

  try {
    const builds = await options.dataService.getBuildsForJob(options.environment, jobUrl, 20);
    return builds
      .filter((build) => typeof build.number === "number")
      .map((build) => ({
        number: build.number,
        runId: `${job.fullPath.join("/")}#${build.number}`,
        description:
          typeof build.result === "string" && build.result.trim().length > 0
            ? build.result
            : undefined,
        detail:
          typeof build.timestamp === "number" && Number.isFinite(build.timestamp)
            ? new Date(build.timestamp).toLocaleString()
            : undefined
      }));
  } catch {
    // Fall back to manual input if the lookup fails.
    return [];
  }
}

function resolveRunJobUrl(
  environment: JenkinsEnvironmentRef,
  currentJobUrl: string,
  parameter: JobParameter
): string | undefined {
  const environmentOrigin = resolveOrigin(environment.url);

  const raw = parameter.runProjectName?.trim();
  if (!raw) {
    return isSameOrigin(currentJobUrl, environmentOrigin) ? currentJobUrl : undefined;
  }

  let candidate: string | undefined;
  let absolute: URL | undefined;
  try {
    absolute = new URL(raw);
  } catch {
    // Not an absolute URL.
  }

  if (absolute) {
    const absoluteUrl = ensureTrailingSlash(absolute.toString());
    if (parseJobUrl(absoluteUrl, environment.url)) {
      candidate = absoluteUrl;
    }
  } else {
    try {
      const relative = ensureTrailingSlash(
        new URL(raw, ensureTrailingSlash(environment.url)).toString()
      );
      if (parseJobUrl(relative, environment.url)) {
        candidate = relative;
      } else {
        const segments = raw
          .split("/")
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0);
        if (segments.length > 0) {
          candidate = segments.reduce(
            (parentUrl, segment) => buildJobUrl(parentUrl, segment),
            ensureTrailingSlash(environment.url)
          );
        }
      }
    } catch {
      // Ignore invalid relative URL or job name.
    }
  }

  return candidate && isSameOrigin(candidate, environmentOrigin) ? candidate : undefined;
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
