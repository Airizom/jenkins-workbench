import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export interface JenkinsJobTarget {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  label: string;
}
