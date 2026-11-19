import type { ArtifactAction, BuildFailureArtifact } from "../shared/BuildDetailsContracts";
import type {
  ArtifactActionMessage,
  SetBuildFollowingMessage
} from "../shared/BuildDetailsPanelMessages";
import type { BuildDetailsState } from "./state/buildDetailsState";

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

export function buildFollowActionMessage(
  state: BuildDetailsState
): SetBuildFollowingMessage | undefined {
  const { followState, loadToken, buildNumber, queueId } = state;
  if (
    state.resultClass !== "running" ||
    loadToken === undefined ||
    !followState ||
    state.followTargetToken !== followState.followTargetToken ||
    buildNumber !== followState.buildNumber ||
    queueId !== followState.queueId
  )
    return undefined;
  return {
    type: "setBuildFollowing",
    loadToken,
    followTargetToken: followState.followTargetToken,
    buildNumber,
    queueId,
    following: !followState.following
  };
}
