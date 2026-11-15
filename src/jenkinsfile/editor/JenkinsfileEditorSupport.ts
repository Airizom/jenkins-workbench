import type * as vscode from "vscode";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type {
  JenkinsfileDocumentScope,
  JenkinsfileStepParameter,
  JenkinsfileStepSignature
} from "../JenkinsfileIntelligenceTypes";

export function canProvideJenkinsfileIntelligence(
  intelligenceConfig: JenkinsfileIntelligenceConfigState,
  scope: JenkinsfileDocumentScope,
  document: vscode.TextDocument
): boolean {
  return intelligenceConfig.isEnabled() && scope.matches(document);
}

export function getCallParameters(signature: JenkinsfileStepSignature): JenkinsfileStepParameter[] {
  return signature.parameters.filter((parameter) => !parameter.isBody);
}
