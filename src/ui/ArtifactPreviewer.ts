import * as path from "node:path";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { ArtifactRetrievalService } from "../services/ArtifactRetrievalService";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";
import { openBufferedContentPreview } from "./BufferedContentPreviewer";

export interface ArtifactPreviewRequest {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  relativePath: string;
  fileName?: string;
}

export interface ArtifactPreviewOptions {
  maxBytes?: number;
}

export type ArtifactPreviewOptionsProvider = () => ArtifactPreviewOptions;

export class ArtifactPreviewer {
  constructor(
    private readonly retrievalService: ArtifactRetrievalService,
    private readonly previewProvider: ArtifactPreviewProvider,
    private readonly optionsProvider: ArtifactPreviewOptionsProvider
  ) {}

  async preview(request: ArtifactPreviewRequest): Promise<void> {
    const options = this.optionsProvider();
    const previewPath = resolvePreviewPath(request);
    const fileName = path.basename(previewPath);

    const response = await this.retrievalService.getArtifact(
      request.environment,
      request.buildUrl,
      request.relativePath,
      { maxBytes: options.maxBytes }
    );

    await openBufferedContentPreview(this.previewProvider, response, previewPath, fileName);
  }
}

function resolvePreviewPath(request: ArtifactPreviewRequest): string {
  const fileName = normalizeOptionalName(request.fileName);
  const relativePath = normalizeOptionalName(request.relativePath);
  if (fileName) {
    if (!relativePath) {
      return fileName;
    }
    if (path.extname(fileName).length > 0) {
      return fileName;
    }
    if (path.extname(relativePath).length > 0) {
      return relativePath;
    }
    return fileName;
  }
  if (relativePath) {
    return relativePath;
  }
  return "artifact";
}

function normalizeOptionalName(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
