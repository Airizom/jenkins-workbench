import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { ArtifactPreviewOptionsProvider } from "./ArtifactPreviewer";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";
import { openBufferedContentPreview } from "./BufferedContentPreviewer";

export class WorkspacePreviewer {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly previewProvider: ArtifactPreviewProvider,
    private readonly optionsProvider: ArtifactPreviewOptionsProvider
  ) {}

  async preview(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    relativePath: string,
    fileName?: string
  ): Promise<void> {
    const options = this.optionsProvider();
    const previewPath = fileName?.trim() || relativePath || "workspace-file";
    const response = await this.dataService.getWorkspaceFile(environment, jobUrl, relativePath, {
      maxBytes: options.maxBytes
    });

    await openBufferedContentPreview(this.previewProvider, response, previewPath, "workspace-file");
  }
}
