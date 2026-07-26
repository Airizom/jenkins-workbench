import type {
  ArtifactAction,
  BuildFailureArtifact,
  BuildTestCaseViewModel
} from "../shared/BuildDetailsContracts";
import type {
  ArtifactActionMessage,
  OpenTestSourceMessage,
  ReloadTestReportMessage
} from "../shared/BuildDetailsPanelMessages";

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
