import * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import { analyzeJenkinsfileContext } from "../JenkinsfileContextAnalyzer";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type {
  JenkinsfileStepDefinition,
  JenkinsfileStepParameter,
  JenkinsfileStepSignature
} from "../JenkinsfileIntelligenceTypes";
import type { JenkinsfileStepCatalogService } from "../JenkinsfileStepCatalogService";
import { canProvideJenkinsfileIntelligence } from "./JenkinsfileEditorSupport";

export class JenkinsfileSignatureHelpProvider implements vscode.SignatureHelpProvider {
  constructor(
    private readonly intelligenceConfig: JenkinsfileIntelligenceConfigState,
    private readonly matcher: JenkinsfileMatcher,
    private readonly stepCatalogService: JenkinsfileStepCatalogService
  ) {}

  async provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.SignatureHelp | undefined> {
    if (!canProvideJenkinsfileIntelligence(this.intelligenceConfig, this.matcher, document)) {
      return;
    }

    const analysis = analyzeJenkinsfileContext(document, position);
    if (!analysis.isStepAllowed || !analysis.activeCall || !analysis.argumentContext) {
      return;
    }

    const result = await this.stepCatalogService.getCatalogForDocument(document);
    const step = result.catalog.steps.get(analysis.activeCall.name);
    if (!step) {
      return;
    }

    const signatures = step.signatures.map(toSignatureInformation);
    if (signatures.length === 0) {
      return;
    }

    const help = new vscode.SignatureHelp();
    help.signatures = signatures;
    help.activeSignature = resolveActiveSignature(step, analysis.argumentContext.usesNamedArgs);
    help.activeParameter = resolveActiveParameter(
      step.signatures[help.activeSignature] ?? step.signatures[0],
      analysis.argumentContext
    );
    return help;
  }
}

function toSignatureInformation(signature: JenkinsfileStepSignature): vscode.SignatureInformation {
  const info = new vscode.SignatureInformation(signature.label);
  info.parameters = signature.parameters
    .filter((parameter) => !parameter.isBody)
    .map(
      (parameter) =>
        new vscode.ParameterInformation(buildParameterLabel(parameter), parameter.description)
    );
  return info;
}

function buildParameterLabel(parameter: JenkinsfileStepParameter): string {
  return parameter.type ? `${parameter.name}: ${parameter.type}` : parameter.name;
}

function resolveActiveSignature(step: JenkinsfileStepDefinition, usesNamedArgs: boolean): number {
  const match = step.signatures.findIndex((signature) => signature.usesNamedArgs === usesNamedArgs);
  return match >= 0 ? match : 0;
}

function resolveActiveParameter(
  signature: JenkinsfileStepSignature,
  context: { activeIndex: number; activeName?: string }
): number {
  const parameters = signature.parameters.filter((parameter) => !parameter.isBody);
  if (parameters.length === 0) {
    return 0;
  }
  if (context.activeName) {
    const index = parameters.findIndex((parameter) => parameter.name === context.activeName);
    return index >= 0 ? index : 0;
  }
  return Math.min(context.activeIndex, parameters.length - 1);
}
