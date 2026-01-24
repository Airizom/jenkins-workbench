import * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../JenkinsfileMatcher";
import { findPipelineBlock } from "./JenkinsfilePipelineParser";

export class JenkinsfileValidationCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly matcher: JenkinsfileMatcher) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.matcher.matches(document)) {
      return [];
    }

    const pipelineContext = findPipelineBlock(document);
    if (!pipelineContext) {
      return [];
    }

    const range = new vscode.Range(pipelineContext.openLine, 0, pipelineContext.openLine, 0);
    const command: vscode.Command = {
      title: "Validate Jenkinsfile",
      command: "jenkinsWorkbench.jenkinsfile.validateActive"
    };

    return [new vscode.CodeLens(range, command)];
  }
}
