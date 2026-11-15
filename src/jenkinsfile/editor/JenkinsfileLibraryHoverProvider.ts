import * as vscode from "vscode";
import { CONFIG_KEYS, CONFIG_SECTION } from "../../extension/ExtensionConfigDefinitions";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type {
  JenkinsfileDocumentScope,
  JenkinsfileSharedLibrarySource,
  JenkinsfileSharedLibrarySummary
} from "../JenkinsfileIntelligenceTypes";
import { findLibraryRefAt } from "../model/JenkinsfileDocumentModel";
import { getJenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelCache";
import { canProvideJenkinsfileIntelligence } from "./JenkinsfileEditorSupport";

const SHARED_LIBRARIES_SETTING = `${CONFIG_SECTION}.${CONFIG_KEYS.jenkinsfileSharedLibraries}`;

/** Hover for `@Library('name@ref')` and `library 'name'` ids: where the library maps locally. */
export class JenkinsfileLibraryHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly intelligenceConfig: JenkinsfileIntelligenceConfigState,
    private readonly scope: JenkinsfileDocumentScope,
    private readonly librarySource: Pick<JenkinsfileSharedLibrarySource, "getLibrary">
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    if (!canProvideJenkinsfileIntelligence(this.intelligenceConfig, this.scope, document)) {
      return undefined;
    }
    const model = getJenkinsfileDocumentModel(document);
    const ref = findLibraryRefAt(model, document.offsetAt(position));
    const name = ref?.name.trim();
    if (!ref || !name) {
      return undefined;
    }

    const library = await this.librarySource.getLibrary(name);
    const markdown = new vscode.MarkdownString();
    if (library) {
      appendMappedLibrary(markdown, library, ref.ref);
    } else {
      markdown.appendMarkdown("No local checkout for library '");
      markdown.appendText(name);
      markdown.appendMarkdown(`' — map it in \`${SHARED_LIBRARIES_SETTING}\``);
    }
    return new vscode.Hover(
      markdown,
      new vscode.Range(
        document.positionAt(ref.nameRange.start),
        document.positionAt(ref.nameRange.end)
      )
    );
  }
}

function appendMappedLibrary(
  markdown: vscode.MarkdownString,
  library: JenkinsfileSharedLibrarySummary,
  requestedRef: string | undefined
): void {
  markdown.appendMarkdown("**Shared library** ");
  markdown.appendText(library.name);
  markdown.appendMarkdown("\n\n");
  markdown.appendMarkdown("Local path: ");
  markdown.appendText(vscode.Uri.parse(library.rootUri).fsPath);
  markdown.appendMarkdown("\n\n");
  const count = library.varNames.length;
  markdown.appendMarkdown(`Global variables: ${count} var${count === 1 ? "" : "s"}\n\n`);
  markdown.appendMarkdown(`Mapping: ${describeMapping(library)}`);
  if (requestedRef) {
    markdown.appendMarkdown("\n\nRequested version ");
    markdown.appendText(requestedRef);
    markdown.appendMarkdown(" is not checked; the local folder is used as-is.");
  }
}

function describeMapping(library: JenkinsfileSharedLibrarySummary): string {
  if (library.implicit) {
    return "implicit";
  }
  return library.configured ? "configured" : "discovered";
}
