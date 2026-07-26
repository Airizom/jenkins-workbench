import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { EnvironmentWithScope } from "../storage/JenkinsEnvironmentStore";

export function toJenkinsEnvironmentRef(environment: EnvironmentWithScope): JenkinsEnvironmentRef {
  return {
    environmentId: environment.id,
    scope: environment.scope,
    url: environment.url,
    username: environment.username
  };
}
