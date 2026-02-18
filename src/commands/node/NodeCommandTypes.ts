import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export interface NodeCommandRefreshHost extends EnvironmentScopedRefreshHost {}

export interface NodeCommandTarget {
  environment: JenkinsEnvironmentRef;
  nodeUrl: string;
  label?: string;
}
