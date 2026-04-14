import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export type BuildDetailsCanOpenTestSource = (
  environment: JenkinsEnvironmentRef | undefined,
  buildUrl: string | undefined,
  className?: string
) => boolean;
