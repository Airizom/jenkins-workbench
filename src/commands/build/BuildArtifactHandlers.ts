import type { ArtifactTreeItem } from "../../tree/TreeItems";
import type { ArtifactActionHandler } from "../../ui/ArtifactActionHandler";
import { requireSelection } from "../CommandUtils";

function getArtifactRequest(item: ArtifactTreeItem) {
  return {
    environment: item.environment,
    buildUrl: item.buildUrl,
    buildNumber: item.buildNumber,
    relativePath: item.relativePath,
    fileName: item.fileName,
    jobNameHint: item.jobNameHint
  };
}

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
    ...getArtifactRequest(selected)
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
    ...getArtifactRequest(selected)
  });
}
