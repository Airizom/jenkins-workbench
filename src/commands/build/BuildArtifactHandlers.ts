import type { ArtifactTreeItem, BuildTreeItem } from "../../tree/TreeItems";
import type { ArtifactActionHandler, ArtifactActionRequest } from "../../ui/ArtifactActionHandler";
import { requireSelection } from "../CommandUtils";

function resolveArtifactRequest(
  item: ArtifactTreeItem | undefined,
  action: "preview" | "download"
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

export async function downloadAllArtifacts(
  artifactActionHandler: ArtifactActionHandler,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to download all artifacts as ZIP.");
  if (!selected) {
    return;
  }

  await artifactActionHandler.handle({
    action: "downloadAll",
    environment: selected.environment,
    buildUrl: selected.buildUrl,
    buildNumber: selected.buildNumber,
    jobNameHint: selected.jobNameHint
  });
}
