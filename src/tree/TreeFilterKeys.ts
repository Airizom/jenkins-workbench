import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

export function buildOverrideKey(environment: JenkinsEnvironmentRef, jobUrl: string): string {
  return `${environment.scope}:${environment.environmentId}:${jobUrl}`;
}
