import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

export function getValidationEnvironmentIdentity(environment: JenkinsEnvironmentRef): string {
  return [
    environment.environmentId,
    environment.scope,
    environment.url,
    environment.username ?? ""
  ].join("|");
}
