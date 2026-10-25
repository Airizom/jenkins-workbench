import type {
  ArtifactAction,
  BuildFailureArtifact,
  BuildTestCaseViewModel
} from "../shared/BuildDetailsContracts";
import type {
  ArtifactActionMessage,
  DownloadAllArtifactsMessage,
  OpenTestSourceMessage,
  ReloadTestReportMessage
} from "../shared/BuildDetailsPanelMessages";

export function buildDownloadAllArtifactsMessage(): DownloadAllArtifactsMessage {
  return { type: "downloadAllArtifacts" };
}

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

export function buildReloadTestReportMessage(): ReloadTestReportMessage {
  return {
    type: "reloadTestReport",
    includeCaseLogs: true
  };
}

export function buildOpenTestSourceMessage(
  testCase: BuildTestCaseViewModel
): OpenTestSourceMessage {
  return {
    type: "openTestSource",
    testName: testCase.name,
    className: testCase.className,
    suiteName: testCase.suiteName
  };
}
