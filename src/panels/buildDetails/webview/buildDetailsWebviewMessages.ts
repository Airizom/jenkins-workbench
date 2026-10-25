import type { ArtifactAction, BuildFailureArtifact } from "../shared/BuildDetailsContracts";
import type { ArtifactActionMessage } from "../shared/BuildDetailsPanelMessages";

export function buildArtifactActionMessage(
  action: ArtifactAction,
  artifact: BuildFailureArtifact
): ArtifactActionMessage {
  return {
    type: "artifactAction",
    action,
    relativePath: artifact.relativePath,
    fileName: artifact.fileName ?? undefined
  };
}
