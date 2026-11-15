import * as vscode from "vscode";
import { WORD_CHAR_PATTERN } from "../context/JenkinsfileContextConstants";
import {
  findIdentifierAt,
  findMemberAccessAt,
  findNextMeaningfulIndex,
  findPreviousMeaningfulIndex,
  readIdentifier
} from "../context/JenkinsfileContextNavigation";
import type { JenkinsfileIdentifier } from "../context/JenkinsfileContextTypes";
import { resolveMembers } from "../globals/JenkinsfileMemberResolver";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type {
  JenkinsfileCatalogSource,
  JenkinsfileDocumentScope,
  JenkinsfileStepCatalog
} from "../JenkinsfileIntelligenceTypes";
import { getJenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelCache";
import type { JenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelTypes";
import { isIdentifierStart } from "../model/JenkinsfileModelArguments";
import { canProvideJenkinsfileIntelligence } from "./JenkinsfileEditorSupport";

/**
 * Go to Definition for shared-library globals (`foo`, `foo.bar`) and for methods declared at
 * the top level of the current document.
 */
export class JenkinsfileDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private readonly intelligenceConfig: JenkinsfileIntelligenceConfigState,
    private readonly scope: JenkinsfileDocumentScope,
    private readonly catalogSource: JenkinsfileCatalogSource
  ) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location | undefined> {
    if (!canProvideJenkinsfileIntelligence(this.intelligenceConfig, this.scope, document)) {
      return undefined;
    }
    const model = getJenkinsfileDocumentModel(document);
    const { maskedText } = model;
    // String and comment contents are blanked in the masked text, so nothing resolves there.
    const offset = document.offsetAt(position);
    const identifier = findIdentifierAt(maskedText, offset);
    if (!identifier || !isIdentifierStart(identifier.name[0])) {
      return undefined;
    }

    const access = findMemberAccessAt(maskedText, offset);
    if (access) {
      // Library members have a location; global (`env`, `currentBuild`) members do not.
      const members = access.receiver
        ? await resolveMembers(access.receiver, model, () => this.loadCatalog(document))
        : [];
      const member = members.find(
        (candidate) => candidate.origin === "sharedLibrary" && candidate.name === identifier.name
      );
      return member?.origin === "sharedLibrary"
        ? toLocation(member.uri, member.line, member.character)
        : undefined;
    }

    if (isDeclarationOrKey(maskedText, identifier)) {
      return undefined;
    }

    const local = findLocalMethod(document, model, identifier.name);
    if (local) {
      return local;
    }
    const source = (await this.loadCatalog(document)).steps.get(identifier.name)?.source;
    return source ? toLocation(source.uri, source.line, source.character) : undefined;
  }

  private async loadCatalog(document: vscode.TextDocument): Promise<JenkinsfileStepCatalog> {
    return (await this.catalogSource.getCatalogForDocument(document)).catalog;
  }
}

/** Map keys and named arguments (`foo: 1`) and assignment targets (`foo = 1`). */
function isDeclarationOrKey(maskedText: string, identifier: JenkinsfileIdentifier): boolean {
  const next = findNextMeaningfulIndex(maskedText, identifier.end);
  if (next === undefined) {
    return false;
  }
  const character = maskedText[next];
  const following = maskedText[next + 1];
  if (character === ":") {
    return following !== ":" && isKeyPosition(maskedText, identifier);
  }
  return character === "=" && following !== "=" && following !== "~";
}

/**
 * Whether `identifier:` starts a map key, named argument, or label: after `(`, `[`, `,`, a
 * statement boundary, or a bare call name (`git url: ...`). The `:` of a ternary
 * (`cond ? helper : x`, `cond ? !helper : x`) or a `case helper:` label ends a reference instead.
 */
function isKeyPosition(maskedText: string, identifier: JenkinsfileIdentifier): boolean {
  const previous = findPreviousMeaningfulIndex(maskedText, identifier.start - 1);
  if (previous === undefined) {
    return true;
  }
  const character = maskedText[previous];
  if (WORD_CHAR_PATTERN.test(character)) {
    return readIdentifier(maskedText, previous).name !== "case";
  }
  return "([,{};".includes(character);
}

function findLocalMethod(
  document: vscode.TextDocument,
  model: JenkinsfileDocumentModel,
  name: string
): vscode.Location | undefined {
  const method = model.methods.find((candidate) => candidate.name === name);
  if (!method) {
    return undefined;
  }
  return new vscode.Location(
    document.uri,
    new vscode.Range(
      document.positionAt(method.nameRange.start),
      document.positionAt(method.nameRange.end)
    )
  );
}

function toLocation(uri: string, line: number, character: number): vscode.Location | undefined {
  let parsed: vscode.Uri;
  try {
    parsed = vscode.Uri.parse(uri);
  } catch {
    return undefined;
  }
  return new vscode.Location(parsed, new vscode.Position(line, character));
}
