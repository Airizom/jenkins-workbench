import * as vscode from "vscode";
import type { JenkinsfileContextAnalysis } from "../context/JenkinsfileContextTypes";
import {
  collectDirectStatementNames,
  getPipelineGrammarEntry,
  type JenkinsfileDeclarativeEntry,
  resolveDeclarativeGrammar
} from "../declarative/JenkinsfileDeclarativeGrammar";
import {
  JENKINSFILE_GLOBAL_VARIABLES,
  type JenkinsfileGlobalMember
} from "../globals/JenkinsfileGlobalVariables";
import { resolveMembers } from "../globals/JenkinsfileMemberResolver";
import { analyzeJenkinsfileContext } from "../JenkinsfileContextAnalyzer";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type {
  JenkinsfileCatalogSource,
  JenkinsfileDocumentScope,
  JenkinsfileSharedLibraryMember,
  JenkinsfileSharedLibrarySource,
  JenkinsfileSharedLibrarySummary,
  JenkinsfileStepCatalog,
  JenkinsfileStepDefinition
} from "../JenkinsfileIntelligenceTypes";
import {
  findInnermostBlock,
  findLibraryRefAt,
  isInsideStringOrComment
} from "../model/JenkinsfileDocumentModel";
import { getJenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelCache";
import { canProvideJenkinsfileIntelligence, getCallParameters } from "./JenkinsfileEditorSupport";

/**
 * Characters that should open completion: member access and the opening quote of an
 * `@Library('...')` / `library '...'` name.
 */
export const JENKINSFILE_COMPLETION_TRIGGER_CHARACTERS: readonly string[] = [".", "'", '"'];

export class JenkinsfileCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly intelligenceConfig: JenkinsfileIntelligenceConfigState,
    private readonly scope: JenkinsfileDocumentScope,
    private readonly catalogSource: JenkinsfileCatalogSource,
    private readonly librarySource?: Pick<JenkinsfileSharedLibrarySource, "getLibraries">
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token?: vscode.CancellationToken,
    context?: vscode.CompletionContext
  ): Promise<vscode.CompletionList | undefined> {
    if (!canProvideJenkinsfileIntelligence(this.intelligenceConfig, this.scope, document)) {
      return;
    }

    // A trigger character only opens its own kind of completion: a quote opens library names,
    // a dot opens members. Closing a string or typing a decimal point must not list steps.
    const trigger =
      context && context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter
        ? context.triggerCharacter
        : undefined;
    const offset = document.offsetAt(position);
    const inStringOrComment = isInsideStringOrComment(
      getJenkinsfileDocumentModel(document),
      offset
    );
    if (trigger === "'" || trigger === '"') {
      return inStringOrComment ? this.provideLibraryNameItems(document, offset) : undefined;
    }
    if (inStringOrComment) {
      return trigger === undefined ? this.provideLibraryNameItems(document, offset) : undefined;
    }

    const analysis = analyzeJenkinsfileContext(document, position);
    if (analysis.memberAccess) {
      return this.provideMemberItems(document, analysis);
    }
    if (trigger !== undefined) {
      return undefined;
    }

    const declarativeContext = analysis.declarativeContext;
    if (declarativeContext && !analysis.isStepAllowed && analysis.isStatementStart) {
      return this.provideDeclarativeItems(document, position, offset, analysis, declarativeContext);
    }

    if (analysis.canSuggestStep) {
      return this.provideStepItems(document, position, analysis);
    }
    return undefined;
  }

  private async provideLibraryNameItems(
    document: vscode.TextDocument,
    offset: number
  ): Promise<vscode.CompletionList | undefined> {
    if (!this.librarySource) {
      return undefined;
    }
    const model = getJenkinsfileDocumentModel(document);
    const ref = findLibraryRefAt(model, offset);
    if (!ref) {
      return undefined;
    }
    const withinName = ref.nameRange.start <= offset && offset <= ref.nameRange.end;
    if (!withinName && ref.name !== "") {
      return undefined;
    }
    const libraries = await this.librarySource.getLibraries();
    const range = toRange(document, ref.nameRange.start, ref.nameRange.end);
    const items = libraries.map((library) => createLibraryNameItem(library, range));
    return new vscode.CompletionList(items, false);
  }

  private async provideMemberItems(
    document: vscode.TextDocument,
    analysis: JenkinsfileContextAnalysis
  ): Promise<vscode.CompletionList | undefined> {
    const access = analysis.memberAccess;
    if (!access) {
      return undefined;
    }
    const model = getJenkinsfileDocumentModel(document);
    const range = toRange(document, access.start, access.end);
    const members = await resolveMembers(
      access.receiver,
      model,
      async () => (await this.catalogSource.getCatalogForDocument(document)).catalog
    );
    // Global members come first, so `index` is their position among globals.
    const items = members.map((member, index) =>
      member.origin === "global"
        ? createGlobalMemberItem(member, range, index)
        : createLibraryMemberItem(member, range)
    );

    return items.length > 0 ? new vscode.CompletionList(items, false) : undefined;
  }

  private async provideDeclarativeItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    offset: number,
    analysis: JenkinsfileContextAnalysis,
    declarativeContext: string
  ): Promise<vscode.CompletionList | undefined> {
    const grammar = resolveDeclarativeGrammar(declarativeContext, analysis.blockPath);
    const result = await this.catalogSource.getCatalogForDocument(document);
    const liveDirectives = result.catalog.directives.get(grammar?.key ?? declarativeContext);
    if (!grammar && !liveDirectives) {
      return undefined;
    }

    const model = getJenkinsfileDocumentModel(document);
    const present = collectDirectStatementNames(model, findInnermostBlock(model, offset), offset);
    const range = resolveWordRange(document, position, analysis);
    const items = collectDeclarativeItems(grammar?.entries ?? [], liveDirectives, present, range);

    return items.length > 0 ? new vscode.CompletionList(items, false) : undefined;
  }

  private async provideStepItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    analysis: JenkinsfileContextAnalysis
  ): Promise<vscode.CompletionList> {
    const prefix = analysis.partialIdentifier?.name ?? "";
    const range = resolveWordRange(document, position, analysis);

    const result = await this.catalogSource.getCatalogForDocument(document);
    const hasNodeContext =
      analysis.hasNodeContext || this.scope.isLibraryVarsFile?.(document) === true;
    const items = collectStepItems(result.catalog, hasNodeContext, prefix, range);

    for (const variable of JENKINSFILE_GLOBAL_VARIABLES) {
      if (!variable.name.startsWith(prefix)) {
        continue;
      }
      const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
      item.range = range;
      item.detail = variable.detail;
      item.documentation = new vscode.MarkdownString(variable.documentation);
      item.sortText = `a:${variable.name}`;
      items.push(item);
    }

    if (analysis.declarativeContext === "root" && "pipeline".startsWith(prefix)) {
      if (!getJenkinsfileDocumentModel(document).pipelineBlock) {
        const item = createGrammarItem(getPipelineGrammarEntry(), range);
        item.sortText = "0:pipeline";
        items.push(item);
      }
    }

    return new vscode.CompletionList(items, false);
  }
}

function collectDeclarativeItems(
  entries: readonly JenkinsfileDeclarativeEntry[],
  liveDirectives: ReadonlyMap<string, JenkinsfileStepDefinition> | undefined,
  present: ReadonlySet<string>,
  range: vscode.Range
): vscode.CompletionItem[] {
  const bundled = new Map(entries.map((entry) => [entry.name, entry]));
  const items: vscode.CompletionItem[] = [];
  for (const entry of bundled.values()) {
    if (liveDirectives?.has(entry.name)) {
      continue;
    }
    if (entry.singleton && present.has(entry.name)) {
      continue;
    }
    items.push(createGrammarItem(entry, range));
  }
  for (const directive of liveDirectives?.values() ?? []) {
    if (bundled.get(directive.name)?.singleton && present.has(directive.name)) {
      continue;
    }
    items.push(createDirectiveItem(directive, bundled.get(directive.name), range));
  }
  return items;
}

function collectStepItems(
  catalog: JenkinsfileStepCatalog,
  hasNodeContext: boolean,
  prefix: string,
  range: vscode.Range
): vscode.CompletionItem[] {
  return [...catalog.steps.values()]
    .filter((step) => !step.requiresNodeContext || hasNodeContext)
    .filter((step) => step.name.startsWith(prefix))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((step) => createStepItem(step, range));
}

function resolveWordRange(
  document: vscode.TextDocument,
  position: vscode.Position,
  analysis: JenkinsfileContextAnalysis
): vscode.Range {
  return analysis.partialIdentifier
    ? toRange(document, analysis.partialIdentifier.start, analysis.partialIdentifier.end)
    : new vscode.Range(position, position);
}

function toRange(document: vscode.TextDocument, start: number, end: number): vscode.Range {
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

function createStepItem(
  step: JenkinsfileStepDefinition,
  range: vscode.Range
): vscode.CompletionItem {
  // A library var without `def call` is an object whose methods are used as `name.method()`.
  const isObjectVar = step.source !== undefined && step.signatures.length === 0;
  const item = new vscode.CompletionItem(
    step.name,
    isObjectVar ? vscode.CompletionItemKind.Variable : vscode.CompletionItemKind.Function
  );
  item.range = range;
  item.detail = step.source ? `Shared library: ${step.source.library}` : step.displayName;
  item.documentation = step.documentation
    ? new vscode.MarkdownString(step.documentation)
    : undefined;
  item.insertText = isObjectVar ? step.name : buildStepSnippet(step);
  item.sortText = `${step.isAdvanced ? "z" : "a"}:${step.name}`;
  return item;
}

function createGrammarItem(
  entry: JenkinsfileDeclarativeEntry,
  range: vscode.Range
): vscode.CompletionItem {
  const kind =
    entry.kind === "section" || entry.kind === "condition"
      ? vscode.CompletionItemKind.Keyword
      : vscode.CompletionItemKind.Property;
  const item = new vscode.CompletionItem(entry.name, kind);
  item.range = range;
  item.detail = `Declarative ${entry.kind}`;
  item.documentation = new vscode.MarkdownString(entry.documentation);
  item.insertText = new vscode.SnippetString(entry.snippet);
  item.sortText = `0:${entry.name}`;
  return item;
}

function createDirectiveItem(
  directive: JenkinsfileStepDefinition,
  bundled: JenkinsfileDeclarativeEntry | undefined,
  range: vscode.Range
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(directive.name, vscode.CompletionItemKind.Property);
  item.range = range;
  item.detail = directive.displayName || "Declarative directive";
  const documentation = directive.documentation ?? bundled?.documentation;
  item.documentation = documentation ? new vscode.MarkdownString(documentation) : undefined;
  item.insertText = buildStepSnippet(directive);
  item.sortText = `0:${directive.name}`;
  return item;
}

function createGlobalMemberItem(
  member: JenkinsfileGlobalMember,
  range: vscode.Range,
  index: number
): vscode.CompletionItem {
  const kind =
    member.kind === "method"
      ? vscode.CompletionItemKind.Method
      : vscode.CompletionItemKind.Property;
  const item = new vscode.CompletionItem(member.label, kind);
  item.range = range;
  item.filterText = member.name;
  item.detail = member.detail;
  item.documentation = member.documentation
    ? new vscode.MarkdownString(member.documentation)
    : undefined;
  if (member.snippet) {
    item.insertText = new vscode.SnippetString(member.snippet);
  } else {
    item.insertText = member.name;
  }
  // Keep the resolver order: file-declared names first, then bundled ones.
  item.sortText = `a:${String(index).padStart(4, "0")}`;
  return item;
}

function createLibraryMemberItem(
  member: JenkinsfileSharedLibraryMember,
  range: vscode.Range
): vscode.CompletionItem {
  const isMethod = member.signatureLabel.includes("(");
  const item = new vscode.CompletionItem(
    member.name,
    isMethod ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property
  );
  item.range = range;
  item.detail = member.signatureLabel;
  item.documentation = member.documentation
    ? new vscode.MarkdownString(member.documentation)
    : undefined;
  item.insertText = isMethod
    ? new vscode.SnippetString(`${escapeSnippetText(member.name)}($0)`)
    : member.name;
  item.sortText = `b:${member.name}`;
  return item;
}

function createLibraryNameItem(
  library: JenkinsfileSharedLibrarySummary,
  range: vscode.Range
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(library.name, vscode.CompletionItemKind.Module);
  item.range = range;
  item.detail = library.implicit ? "Implicit" : describeLibraryRoot(library.rootUri);
  if (library.varNames.length > 0) {
    item.documentation = new vscode.MarkdownString(
      `Global variables: ${library.varNames.map((name) => `\`${name}\``).join(", ")}`
    );
  }
  return item;
}

function describeLibraryRoot(rootUri: string): string {
  try {
    const uri = vscode.Uri.parse(rootUri);
    return uri.scheme === "file" ? uri.fsPath : rootUri;
  } catch {
    return rootUri;
  }
}

function escapeSnippetText(value: string): string {
  return value.replace(/[$}\\]/g, "\\$&");
}

function buildStepSnippet(step: JenkinsfileStepDefinition): vscode.SnippetString {
  const signature = step.signatures.find((entry) => entry.usesNamedArgs) ?? step.signatures[0];

  if (!signature) {
    return new vscode.SnippetString(`${step.name}()`);
  }

  const parameters = getCallParameters(signature);

  const snippet = new vscode.SnippetString();
  snippet.appendText(`${step.name}(`);

  if (signature.usesNamedArgs && parameters.length > 0) {
    const isClosure = parameters[0].type === "Closure";
    snippet.appendPlaceholder(parameters[0].name);
    snippet.appendText(isClosure ? ": { " : ": ");
    snippet.appendPlaceholder("value");
    if (isClosure) {
      snippet.appendText(" }");
    }
  } else if (!signature.usesNamedArgs && parameters.length === 1) {
    snippet.appendPlaceholder(parameters[0].name === "message" ? "message" : "value");
  }

  snippet.appendText(")");
  appendBody(snippet, signature.takesClosure);
  return snippet;
}

function appendBody(snippet: vscode.SnippetString, takesClosure: boolean): void {
  if (!takesClosure) {
    return;
  }
  snippet.appendText(" {\n\t");
  snippet.appendTabstop();
  snippet.appendText("\n}");
}
