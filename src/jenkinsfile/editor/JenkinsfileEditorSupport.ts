import type * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type {
  JenkinsfileStepParameter,
  JenkinsfileStepSignature
} from "../JenkinsfileIntelligenceTypes";

export function canProvideJenkinsfileIntelligence(
  intelligenceConfig: JenkinsfileIntelligenceConfigState,
  matcher: JenkinsfileMatcher,
  document: vscode.TextDocument
): boolean {
  return intelligenceConfig.isEnabled() && matcher.matches(document);
}

export function getCallParameters(signature: JenkinsfileStepSignature): JenkinsfileStepParameter[] {
  return signature.parameters.filter((parameter) => !parameter.isBody);
}
