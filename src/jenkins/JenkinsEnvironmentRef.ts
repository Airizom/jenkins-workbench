import type { EnvironmentScope, EnvironmentWithScope } from "../storage/JenkinsEnvironmentStore";

export interface JenkinsEnvironmentRef {
  environmentId: string;
  scope: EnvironmentScope;
  url: string;
  name?: string;
  username?: string;
  allowInsecureTls?: boolean;
}

export function toJenkinsEnvironmentRef(environment: EnvironmentWithScope): JenkinsEnvironmentRef {
  return {
    environmentId: environment.id,
    scope: environment.scope,
    url: environment.url,
    name: environment.name,
    username: environment.username,
    ...(environment.allowInsecureTls === true ? { allowInsecureTls: true } : {})
  };
}
