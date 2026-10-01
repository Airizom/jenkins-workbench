import * as vscode from "vscode";
import { JenkinsfileQuickFixProvider } from "../validation/editor/JenkinsfileQuickFixProvider";
import type { JenkinsfileMatcher } from "../validation/JenkinsfileMatcher";

const JENKINSFILE_SIGNATURE_TRIGGER_CHARACTERS = ["(", ",", " ", ":", "'", '"'] as const;

export interface JenkinsfileLanguageFeatureProviders {
  quickFix: JenkinsfileQuickFixProvider;
  hover: vscode.HoverProvider;
  completion: vscode.CompletionItemProvider;
  signatureHelp: vscode.SignatureHelpProvider;
  codeLens: vscode.CodeLensProvider;
}

/**
 * Registers the Jenkinsfile editor providers against the configured Jenkinsfile patterns rather
 * than every file, so VS Code never calls them for unrelated documents. Registrations follow
 * pattern changes from `jenkinsfileValidation.filePatterns`.
 */
export function registerJenkinsfileLanguageFeatures(
  matcher: JenkinsfileMatcher,
  providers: JenkinsfileLanguageFeatureProviders
): vscode.Disposable {
  let registrations: vscode.Disposable[] = [];

  const disposeRegistrations = (): void => {
    for (const registration of registrations) {
      registration.dispose();
    }
    registrations = [];
  };

  const register = (): void => {
    disposeRegistrations();
    const selector = [...matcher.documentSelector];
    if (selector.length === 0) {
      return;
    }
    registrations = [
      vscode.languages.registerCodeActionsProvider(selector, providers.quickFix, {
        providedCodeActionKinds: JenkinsfileQuickFixProvider.providedCodeActionKinds
      }),
      vscode.languages.registerHoverProvider(selector, providers.hover),
      vscode.languages.registerCompletionItemProvider(selector, providers.completion),
      vscode.languages.registerSignatureHelpProvider(
        selector,
        providers.signatureHelp,
        ...JENKINSFILE_SIGNATURE_TRIGGER_CHARACTERS
      ),
      vscode.languages.registerCodeLensProvider(selector, providers.codeLens)
    ];
  };

  register();
  const selectorSubscription = matcher.onDidChangeSelector(register);

  return new vscode.Disposable(() => {
    selectorSubscription.dispose();
    disposeRegistrations();
  });
}
