import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type {
  ArtifactDownloadRequest,
  ArtifactDownloadResult,
  ArtifactStorageService
} from "./ArtifactStorageService";

export interface ArtifactDownloadActionRequest {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  buildNumber?: number;
  relativePath: string;
  fileName?: string;
  jobNameHint?: string;
}

export interface ArtifactActionOptions {
  downloadRoot: string;
  maxBytes?: number;
}

export class ArtifactActionService {
  constructor(private readonly storageService: ArtifactStorageService) {}

  async execute(
    request: ArtifactDownloadActionRequest,
    options: ArtifactActionOptions,
    workspaceRoot: string
  ): Promise<ArtifactDownloadResult> {
    const storageRequest: ArtifactDownloadRequest = {
      environment: request.environment,
      buildUrl: request.buildUrl,
      buildNumber: request.buildNumber,
      relativePath: request.relativePath,
      fileName: request.fileName,
      jobNameHint: request.jobNameHint,
      workspaceRoot,
      downloadRoot: options.downloadRoot,
      maxBytes: options.maxBytes
    };
    return this.storageService.downloadArtifact(storageRequest);
  }
}
