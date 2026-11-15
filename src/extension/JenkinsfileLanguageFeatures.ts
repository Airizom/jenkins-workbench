import * as vscode from "vscode";
import { JENKINSFILE_COMPLETION_TRIGGER_CHARACTERS } from "../jenkinsfile/editor/JenkinsfileCompletionProvider";
import { JenkinsfileQuickFixProvider } from "../validation/editor/JenkinsfileQuickFixProvider";
import type { JenkinsfileMatcher } from "../validation/JenkinsfileMatcher";

const JENKINSFILE_SIGNATURE_TRIGGER_CHARACTERS = ["(", ",", " ", ":", "'", '"'] as const;

/**
 * Shared library global variables. Only intelligence providers register here; each provider
 * still checks `JenkinsfileIntelligenceDocumentScope`, so only files under a known library root
 * get results. Validation, CodeLens, and quick fixes never see this selector.
 */
const SHARED_LIBRARY_VARS_SELECTOR: readonly vscode.DocumentFilter[] = [
  { scheme: "file", pattern: "**/vars/*.groovy" }
];

export interface JenkinsfileLanguageFeatureProviders {
  quickFix: JenkinsfileQuickFixProvider;
  /** Validation and intelligence hovers, for Jenkinsfiles. */
  hover: vscode.HoverProvider;
  /** Intelligence hovers only, for shared library vars files. */
  intelligenceHover: vscode.HoverProvider;
  completion: vscode.CompletionItemProvider;
  signatureHelp: vscode.SignatureHelpProvider;
  codeLens: vscode.CodeLensProvider;
  documentSymbol: vscode.DocumentSymbolProvider;
  definition: vscode.DefinitionProvider;
}

/**
 * Registers the Jenkinsfile editor providers against the configured Jenkinsfile patterns rather
 * than every file, so VS Code never calls them for unrelated documents. Registrations follow
 * pattern changes from `jenkinsfileValidation.filePatterns`. Shared library `vars/*.groovy`
 * files get a separate, intelligence-only registration.
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
      ...registerIntelligenceProviders(selector, providers),
      vscode.languages.registerCodeLensProvider(selector, providers.codeLens),
      vscode.languages.registerDocumentSymbolProvider(selector, providers.documentSymbol, {
        label: "Jenkinsfile"
      })
    ];
  };

  register();
  const selectorSubscription = matcher.onDidChangeSelector(register);
  const varsRegistrations = registerIntelligenceProviders(
    [...SHARED_LIBRARY_VARS_SELECTOR],
    skipMatchedJenkinsfiles(matcher, { ...providers, hover: providers.intelligenceHover })
  );

  return new vscode.Disposable(() => {
    selectorSubscription.dispose();
    disposeRegistrations();
    for (const registration of varsRegistrations) {
      registration.dispose();
    }
  });
}

type IntelligenceProviders = Pick<
  JenkinsfileLanguageFeatureProviders,
  "hover" | "completion" | "signatureHelp" | "definition"
>;

/**
 * Wraps the intelligence providers for the vars selector so they stay silent for documents the
 * Jenkinsfile patterns also match (a catch-all `*.groovy` pattern); that registration already
 * serves them, and answering twice would duplicate completions and hovers.
 */
function skipMatchedJenkinsfiles(
  matcher: JenkinsfileMatcher,
  providers: IntelligenceProviders
): IntelligenceProviders {
  return {
    hover: {
      provideHover: (document, position, token) =>
        matcher.matches(document)
          ? undefined
          : providers.hover.provideHover(document, position, token)
    },
    completion: {
      provideCompletionItems: (document, position, token, context) =>
        matcher.matches(document)
          ? undefined
          : providers.completion.provideCompletionItems(document, position, token, context)
    },
    signatureHelp: {
      provideSignatureHelp: (document, position, token, context) =>
        matcher.matches(document)
          ? undefined
          : providers.signatureHelp.provideSignatureHelp(document, position, token, context)
    },
    definition: {
      provideDefinition: (document, position, token) =>
        matcher.matches(document)
          ? undefined
          : providers.definition.provideDefinition(document, position, token)
    }
  };
}

function registerIntelligenceProviders(
  selector: vscode.DocumentFilter[],
  providers: IntelligenceProviders
): vscode.Disposable[] {
  return [
    vscode.languages.registerHoverProvider(selector, providers.hover),
    vscode.languages.registerCompletionItemProvider(
      selector,
      providers.completion,
      ...JENKINSFILE_COMPLETION_TRIGGER_CHARACTERS
    ),
    vscode.languages.registerSignatureHelpProvider(
      selector,
      providers.signatureHelp,
      ...JENKINSFILE_SIGNATURE_TRIGGER_CHARACTERS
    ),
    vscode.languages.registerDefinitionProvider(selector, providers.definition)
  ];
}
