import type { ArtifactTreeItem } from "../../tree/TreeItems";
import type { ArtifactActionHandler, ArtifactActionRequest } from "../../ui/ArtifactActionHandler";
import { requireSelection } from "../CommandUtils";

function resolveArtifactRequest(
  item: ArtifactTreeItem | undefined,
  action: ArtifactActionRequest["action"]
): ArtifactActionRequest | undefined {
  const selected = requireSelection(item, `Select an artifact to ${action}.`);
  if (!selected) {
    return undefined;
  }

  return {
    action,
    environment: selected.environment,
    buildUrl: selected.buildUrl,
    buildNumber: selected.buildNumber,
    relativePath: selected.relativePath,
    fileName: selected.fileName,
    jobNameHint: selected.jobNameHint
  };
}

export async function previewArtifact(
  artifactActionHandler: ArtifactActionHandler,
  item?: ArtifactTreeItem
): Promise<void> {
  const request = resolveArtifactRequest(item, "preview");
  if (!request) {
    return;
  }

  await artifactActionHandler.handle(request);
}

export async function downloadArtifact(
  artifactActionHandler: ArtifactActionHandler,
  item?: ArtifactTreeItem
): Promise<void> {
  const request = resolveArtifactRequest(item, "download");
  if (!request) {
    return;
  }

  await artifactActionHandler.handle(request);
}
