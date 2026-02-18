import type { ArtifactTreeItem } from "../../tree/TreeItems";
import type { ArtifactActionHandler } from "../../ui/ArtifactActionHandler";
import { requireSelection } from "../CommandUtils";

export async function previewArtifact(
  artifactActionHandler: ArtifactActionHandler,
  item?: ArtifactTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select an artifact to preview.");
  if (!selected) {
    return;
  }

  await artifactActionHandler.handle({
    action: "preview",
    environment: selected.environment,
    buildUrl: selected.buildUrl,
    buildNumber: selected.buildNumber,
    relativePath: selected.relativePath,
    fileName: selected.fileName,
    jobNameHint: selected.jobNameHint
  });
}

export async function downloadArtifact(
  artifactActionHandler: ArtifactActionHandler,
  item?: ArtifactTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select an artifact to download.");
  if (!selected) {
    return;
  }

  await artifactActionHandler.handle({
    action: "download",
    environment: selected.environment,
    buildUrl: selected.buildUrl,
    buildNumber: selected.buildNumber,
    relativePath: selected.relativePath,
    fileName: selected.fileName,
    jobNameHint: selected.jobNameHint
  });
}
