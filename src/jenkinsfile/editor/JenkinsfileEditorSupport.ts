import type * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";

export function canProvideJenkinsfileIntelligence(
  intelligenceConfig: JenkinsfileIntelligenceConfigState,
  matcher: JenkinsfileMatcher,
  document: vscode.TextDocument
): boolean {
  return intelligenceConfig.isEnabled() && matcher.matches(document);
}
