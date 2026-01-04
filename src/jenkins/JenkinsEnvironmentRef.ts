import type { EnvironmentScope } from "../storage/JenkinsEnvironmentStore";

export interface JenkinsEnvironmentRef {
  environmentId: string;
  scope: EnvironmentScope;
  url: string;
  username?: string;
}
