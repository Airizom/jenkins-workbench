import type { JobParameter } from "../../jenkins/JenkinsDataService";

export function isSensitiveParameter(parameter: JobParameter): boolean {
  if (parameter.isSensitive) {
    return true;
  }
  return parameter.kind === "password" || parameter.kind === "credentials";
}
