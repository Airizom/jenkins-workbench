import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { WorkspaceRetrievalService } from "../services/WorkspaceRetrievalService";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";
import type { ArtifactPreviewOptionsProvider } from "./ArtifactPreviewer";
import { openBufferedContentPreview } from "./BufferedContentPreviewer";

export class WorkspacePreviewer {
  constructor(
    private readonly retrievalService: WorkspaceRetrievalService,
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
    const response = await this.retrievalService.getWorkspaceFile(
      environment,
      jobUrl,
      relativePath,
      {
        maxBytes: options.maxBytes
      }
    );

    await openBufferedContentPreview(this.previewProvider, response, previewPath, "workspace-file");
  }
}
