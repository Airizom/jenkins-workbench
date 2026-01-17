import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsConsoleText } from "../jenkins/types";

export class BuildLogService {
  constructor(private readonly dataService: JenkinsDataService) {}

  getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars: number
  ): Promise<JenkinsConsoleText> {
    return this.dataService.getConsoleText(environment, buildUrl, maxChars);
  }
}
