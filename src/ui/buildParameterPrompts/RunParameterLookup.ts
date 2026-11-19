import type { JobParameter } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { buildJobUrl, ensureTrailingSlash, parseJobUrl } from "../../jenkins/urls";
import type { ParameterValuePromptContext } from "./BuildParameterPromptTypes";

export async function fetchRunBuildChoices(
  options: ParameterValuePromptContext,
  parameter: JobParameter
): Promise<Array<{ number: number; runId: string; description?: string; detail?: string }>> {
  const job = resolveRunJob(options.environment, options.jobUrl, parameter);
  if (!job) {
    return [];
  }

  try {
    const builds = await options.dataService.getBuildsForJob(options.environment, job.url, 20);
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

function resolveRunJob(
  environment: JenkinsEnvironmentRef,
  currentJobUrl: string,
  parameter: JobParameter
): { url: string; fullPath: string[] } | undefined {
  const raw = parameter.runProjectName?.trim();
  try {
    const base = new URL(ensureTrailingSlash(environment.url));
    const candidate = new URL(raw || currentJobUrl, base);
    if (
      candidate.origin !== base.origin ||
      !ensureTrailingSlash(candidate.pathname).startsWith(base.pathname)
    )
      return undefined;

    const url = raw ? ensureTrailingSlash(candidate.href) : candidate.href;
    const parsed = parseJobUrl(url, environment.url);
    if (parsed) return { url, fullPath: parsed.fullPath };

    // Only a bare project name may be expanded into a Jenkins folder/job path.
    if (!raw || /^(?:[a-z][a-z\d+.-]*:|[\\/]|\.{1,2}(?:[\\/]|$))/i.test(raw)) return undefined;
    const fullPath = raw
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    return fullPath.length ? { url: fullPath.reduce(buildJobUrl, base.href), fullPath } : undefined;
  } catch {
    return undefined;
  }
}
