import type { FullEnvironmentRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export interface EnvironmentCommandRefreshHost extends FullEnvironmentRefreshHost {
  onEnvironmentRemoved?(environment: JenkinsEnvironmentRef): void;
}
