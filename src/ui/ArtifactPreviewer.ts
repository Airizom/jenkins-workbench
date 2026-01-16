import * as path from "node:path";
import type { IncomingHttpHeaders } from "node:http";
import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";

const IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp"
]);

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
    private readonly dataService: JenkinsDataService,
    private readonly previewProvider: ArtifactPreviewProvider,
    private readonly optionsProvider: ArtifactPreviewOptionsProvider
  ) {}

  async preview(request: ArtifactPreviewRequest): Promise<void> {
    const options = this.optionsProvider();
    const previewPath = resolvePreviewPath(request);
    const fileName = path.basename(previewPath);

    const response = await this.dataService.getArtifact(
      request.environment,
      request.buildUrl,
      request.relativePath,
      { maxBytes: options.maxBytes }
    );

    const uri = this.previewProvider.registerArtifact(response.data, fileName);
    this.previewProvider.markInUse(uri);
    try {
      await openArtifactPreview(uri, response.headers, previewPath);
    } catch (error) {
      this.previewProvider.release(uri);
      throw error;
    }
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

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function isImageContentType(contentType?: string): boolean {
  if (!contentType) {
    return false;
  }
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  return normalized.startsWith("image/");
}

async function openArtifactPreview(
  uri: vscode.Uri,
  headers: IncomingHttpHeaders,
  previewPath: string
): Promise<void> {
  const contentType = getHeaderValue(headers, "content-type");
  const extension = path.extname(previewPath).toLowerCase();
  const isImage = isImageContentType(contentType) || IMAGE_EXTENSIONS.has(extension);

  if (isImage) {
    await vscode.commands.executeCommand("vscode.open", uri, { preview: true });
    return;
  }

  await vscode.window.showTextDocument(uri, { preview: true });
}
