import type { JobParameter } from "../../jenkins/JenkinsDataService";

export function isSensitiveParameter(parameter: JobParameter): boolean {
  return Boolean(
    parameter.isSensitive || parameter.kind === "password" || parameter.kind === "credentials"
  );
}
