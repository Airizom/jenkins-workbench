import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export interface NodeCommandRefreshHost {
  refreshEnvironment(environmentId: string): void;
}

export interface NodeCommandTarget {
  environment: JenkinsEnvironmentRef;
  nodeUrl: string;
  label?: string;
}
