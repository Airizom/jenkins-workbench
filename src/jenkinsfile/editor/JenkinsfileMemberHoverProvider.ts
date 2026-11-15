import * as vscode from "vscode";
import { findMemberAccessAt } from "../context/JenkinsfileContextNavigation";
import {
  type JenkinsfileGlobalMember,
  resolveReceiverType
} from "../globals/JenkinsfileGlobalVariables";
import {
  type JenkinsfileResolvedMember,
  resolveMembers
} from "../globals/JenkinsfileMemberResolver";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type {
  JenkinsfileCatalogSource,
  JenkinsfileDocumentScope,
  JenkinsfileSharedLibraryMember
} from "../JenkinsfileIntelligenceTypes";
import { getJenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelCache";
import { canProvideJenkinsfileIntelligence } from "./JenkinsfileEditorSupport";

/**
 * Hovers for `receiver.member`: `env.X`, `params.X`, `currentBuild.x` (including chains such as
 * `previousBuild.result`), and methods of shared library vars such as `utils.deploy`.
 */
export class JenkinsfileMemberHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly intelligenceConfig: JenkinsfileIntelligenceConfigState,
    private readonly scope: JenkinsfileDocumentScope,
    private readonly catalogSource: JenkinsfileCatalogSource
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const reference = this.findReference(document, position);
    if (!reference) {
      return undefined;
    }
    const { model, receiver, member: target } = reference;
    const members = await resolveMembers(
      receiver,
      model,
      async () => (await this.catalogSource.getCatalogForDocument(document)).catalog
    );
    const matches = members.filter((member) => member.name === target.name);
    if (matches.length === 0) {
      return undefined;
    }

    const receiverType = resolveReceiverType(receiver);
    const markdown = new vscode.MarkdownString();
    matches.forEach((member: JenkinsfileResolvedMember, index) => {
      if (index > 0) {
        markdown.appendMarkdown("\n\n---\n\n");
      }
      if (member.origin === "global") {
        appendGlobalMember(markdown, receiver, receiverType, member);
      } else {
        appendLibraryMember(markdown, receiver, member.library, member);
      }
    });

    return new vscode.Hover(
      markdown,
      new vscode.Range(document.positionAt(target.start), document.positionAt(target.end))
    );
  }

  /** The member under the cursor and its plain receiver chain, when intelligence applies. */
  private findReference(document: vscode.TextDocument, position: vscode.Position) {
    if (!canProvideJenkinsfileIntelligence(this.intelligenceConfig, this.scope, document)) {
      return undefined;
    }
    const model = getJenkinsfileDocumentModel(document);
    const access = findMemberAccessAt(model.maskedText, document.offsetAt(position));
    return access?.receiver
      ? { model, receiver: access.receiver, member: access.member }
      : undefined;
  }
}

function appendGlobalMember(
  markdown: vscode.MarkdownString,
  receiver: readonly string[],
  receiverType: string | undefined,
  member: JenkinsfileGlobalMember
): void {
  const path = [...receiver, member.label].join(".");
  markdown.appendCodeblock(member.type ? `${path}: ${member.type}` : path, "groovy");

  if (receiverType === "env") {
    markdown.appendMarkdown(
      member.declaredInFile ? "Environment variable. Declared in this file." : `${member.detail}.`
    );
  } else if (receiverType === "params") {
    markdown.appendMarkdown(
      `Build parameter (\`${member.type ?? "unknown"}\`). Declared in this file.`
    );
  } else if (receiverType === "RunWrapper") {
    markdown.appendMarkdown(
      member.kind === "method" ? "RunWrapper method." : "RunWrapper property."
    );
  }

  if (member.documentation) {
    markdown.appendMarkdown("\n\n");
    markdown.appendMarkdown(member.documentation);
  }
}

/** Signature, owning library, and documentation; library text is shown literally. */
function appendLibraryMember(
  markdown: vscode.MarkdownString,
  receiver: readonly string[],
  library: string,
  member: JenkinsfileSharedLibraryMember
): void {
  markdown.appendCodeblock([...receiver, member.signatureLabel].join("."), "groovy");
  markdown.appendMarkdown("Shared library method from ");
  markdown.appendText(library);
  markdown.appendMarkdown(".");
  if (member.documentation) {
    markdown.appendMarkdown("\n\n");
    markdown.appendText(member.documentation);
  }
}
