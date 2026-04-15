import type { IncomingHttpHeaders } from "node:http";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";
import { openTextPreview } from "./PreviewLifecycle";

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

type PreviewKind = "image" | "text";

export async function openBufferedContentPreview(
  previewProvider: ArtifactPreviewProvider,
  content: { data: Uint8Array; headers: IncomingHttpHeaders },
  previewPath: string,
  fallbackFileName = "preview"
): Promise<void> {
  const fileName = path.basename(previewPath) || fallbackFileName;
  const uri = previewProvider.registerArtifact(content.data, fileName);
  const previewKind = resolvePreviewKind(content.headers, previewPath);

  if (previewKind === "image") {
    await vscode.commands.executeCommand("vscode.open", uri, { preview: true });
    return;
  }

  await openTextPreview(previewProvider, uri);
}

function resolvePreviewKind(headers: IncomingHttpHeaders, previewPath: string): PreviewKind {
  const contentType = getHeaderValue(headers, "content-type");
  const extension = path.extname(previewPath).toLowerCase();
  return isImageContentType(contentType) || IMAGE_EXTENSIONS.has(extension) ? "image" : "text";
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
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return normalized?.startsWith("image/") ?? false;
}
