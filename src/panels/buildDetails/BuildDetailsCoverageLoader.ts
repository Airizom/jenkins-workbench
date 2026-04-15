import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { BuildDetailsCoverageBackend } from "./BuildDetailsBackend";

export interface BuildDetailsCoverageLoadResult {
  coverageOverview: JenkinsCoverageOverview | undefined;
  modifiedCoverageFiles: JenkinsModifiedCoverageFile[] | undefined;
}

export interface BuildDetailsCoverageLoadRequest {
  coverageBackend: BuildDetailsCoverageBackend;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  buildCompleted: boolean;
  actionPath: string;
  coverageEnabled: boolean;
  decorationsEnabled: boolean;
}

export class BuildDetailsCoverageLoader {
  async load({
    coverageBackend,
    environment,
    buildUrl,
    buildCompleted,
    actionPath,
    coverageEnabled,
    decorationsEnabled
  }: BuildDetailsCoverageLoadRequest): Promise<BuildDetailsCoverageLoadResult> {
    const coverageOverview = coverageEnabled
      ? await coverageBackend.getCoverageOverview(environment, buildUrl, {
          buildCompleted,
          actionPath
        })
      : undefined;

    let modifiedCoverageFiles: JenkinsModifiedCoverageFile[] | undefined;
    if (coverageEnabled || decorationsEnabled) {
      try {
        modifiedCoverageFiles = await coverageBackend.getModifiedCoverageFiles(
          environment,
          buildUrl,
          {
            buildCompleted,
            actionPath
          }
        );
      } catch (error) {
        if (!coverageOverview) {
          throw error;
        }
      }
    }

    return {
      coverageOverview,
      modifiedCoverageFiles
    };
  }
}
