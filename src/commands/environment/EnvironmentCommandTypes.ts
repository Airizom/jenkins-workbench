import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export interface EnvironmentCommandRefreshHost {
  refreshEnvironment(environmentId?: string): void;
  onEnvironmentRemoved?(environment: JenkinsEnvironmentRef): void;
}
