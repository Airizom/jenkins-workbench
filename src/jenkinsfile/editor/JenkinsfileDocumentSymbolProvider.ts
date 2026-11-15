import * as vscode from "vscode";
import {
  DECLARATIVE_PIPELINE_SECTION_NAMES,
  DECLARATIVE_POST_CONDITION_NAMES
} from "../declarative/JenkinsfileDeclarativeGrammar";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type { JenkinsfileDocumentScope } from "../JenkinsfileIntelligenceTypes";
import { getJenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelCache";
import type {
  JenkinsfileBlock,
  JenkinsfileMethodDeclaration,
  JenkinsfileTextRange
} from "../model/JenkinsfileDocumentModelTypes";
import { canProvideJenkinsfileIntelligence } from "./JenkinsfileEditorSupport";

/** Blocks that hold stages: `stages`, `parallel`, and `matrix` (whose `stages` nest inside). */
const STAGE_CONTAINERS = new Set(["stages", "parallel", "matrix"]);

interface PositionedSymbol {
  start: number;
  symbol: vscode.DocumentSymbol;
}

/**
 * Outline for declarative pipelines (sections, nested stages, post conditions), scripted
 * `stage`/`node` blocks, and top-level method declarations.
 */
export class JenkinsfileDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(
    private readonly intelligenceConfig: JenkinsfileIntelligenceConfigState,
    private readonly scope: JenkinsfileDocumentScope
  ) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    if (!canProvideJenkinsfileIntelligence(this.intelligenceConfig, this.scope, document)) {
      return [];
    }
    const model = getJenkinsfileDocumentModel(document);
    return new JenkinsfileSymbolBuilder(document, model.text.length).build(
      model.blocks,
      model.methods
    );
  }
}

class JenkinsfileSymbolBuilder {
  constructor(
    private readonly document: vscode.TextDocument,
    private readonly textLength: number
  ) {}

  build(
    blocks: JenkinsfileBlock[],
    methods: JenkinsfileMethodDeclaration[]
  ): vscode.DocumentSymbol[] {
    const topLevel: PositionedSymbol[] = [];
    const methodSymbols = methods.map((method) => {
      const symbol = this.createSymbol(
        method.name,
        `(${method.parameterText})`,
        vscode.SymbolKind.Method,
        method.range,
        method.nameRange
      );
      topLevel.push({ start: method.range.start, symbol });
      return { method, symbol };
    });

    for (const block of blocks) {
      const owner = methodSymbols.find(
        ({ method }) => method.range.start <= block.openBrace && block.openBrace < method.range.end
      );
      if (owner) {
        owner.symbol.children.push(...this.scripted(block.children));
      } else {
        for (const symbol of this.scripted([block])) {
          topLevel.push({ start: this.document.offsetAt(symbol.range.start), symbol });
        }
      }
    }

    return topLevel.sort((left, right) => left.start - right.start).map(({ symbol }) => symbol);
  }

  /** Scripted `stage`/`node` blocks at any depth; other blocks are flattened away. */
  private scripted(blocks: JenkinsfileBlock[]): vscode.DocumentSymbol[] {
    const symbols: vscode.DocumentSymbol[] = [];
    for (const block of blocks) {
      if (block.label === "pipeline") {
        symbols.push(this.pipeline(block));
      } else if (block.label === "stage") {
        const symbol = this.blockSymbol(block, stageName(block), "", vscode.SymbolKind.Module);
        symbol.children = this.scripted(block.children);
        symbols.push(symbol);
      } else if (block.label === "node") {
        const detail = block.name ? collapseWhitespace(block.name) : "";
        const symbol = this.blockSymbol(block, "node", detail, vscode.SymbolKind.Module);
        symbol.children = this.scripted(block.children);
        symbols.push(symbol);
      } else {
        symbols.push(...this.scripted(block.children));
      }
    }
    return symbols;
  }

  private pipeline(block: JenkinsfileBlock): vscode.DocumentSymbol {
    const symbol = this.blockSymbol(block, "pipeline", "", vscode.SymbolKind.Package);
    symbol.children = block.children
      .filter(
        (child) => child.label !== undefined && DECLARATIVE_PIPELINE_SECTION_NAMES.has(child.label)
      )
      .map((child) => this.section(child));
    return symbol;
  }

  /** A namespace symbol for a declarative section, with stages or post conditions inside. */
  private section(block: JenkinsfileBlock): vscode.DocumentSymbol {
    const label = block.label ?? "";
    const symbol = this.blockSymbol(block, label, "", vscode.SymbolKind.Namespace);
    if (STAGE_CONTAINERS.has(label)) {
      symbol.children = this.stageContainerChildren(block);
    } else if (label === "post") {
      symbol.children = block.children
        .filter(
          (child) => child.label !== undefined && DECLARATIVE_POST_CONDITION_NAMES.has(child.label)
        )
        .map((child) =>
          this.blockSymbol(child, child.label ?? "", "", vscode.SymbolKind.Namespace)
        );
    }
    return symbol;
  }

  private stageContainerChildren(block: JenkinsfileBlock): vscode.DocumentSymbol[] {
    const symbols: vscode.DocumentSymbol[] = [];
    for (const child of block.children) {
      if (child.label === "stage") {
        symbols.push(this.declarativeStage(child));
      } else if (child.label !== undefined && STAGE_CONTAINERS.has(child.label)) {
        symbols.push(this.section(child));
      }
    }
    return symbols;
  }

  private declarativeStage(block: JenkinsfileBlock): vscode.DocumentSymbol {
    const symbol = this.blockSymbol(block, stageName(block), "", vscode.SymbolKind.Module);
    symbol.children = block.children
      .filter(
        (child) =>
          child.label !== undefined && (STAGE_CONTAINERS.has(child.label) || child.label === "post")
      )
      .map((child) => this.section(child));
    return symbol;
  }

  private blockSymbol(
    block: JenkinsfileBlock,
    name: string,
    detail: string,
    kind: vscode.SymbolKind
  ): vscode.DocumentSymbol {
    const range = { start: block.headerStart, end: block.closeBrace + 1 };
    const labelRange =
      block.label !== undefined
        ? { start: block.headerStart, end: block.headerStart + block.label.length }
        : undefined;
    return this.createSymbol(name, detail, kind, range, block.nameRange ?? labelRange, labelRange);
  }

  private createSymbol(
    name: string,
    detail: string,
    kind: vscode.SymbolKind,
    range: JenkinsfileTextRange,
    selection: JenkinsfileTextRange | undefined,
    fallbackSelection?: JenkinsfileTextRange
  ): vscode.DocumentSymbol {
    const start = this.clamp(range.start);
    const end = Math.max(start, this.clamp(range.end));
    const contained = [selection, fallbackSelection].find(
      (candidate): candidate is JenkinsfileTextRange =>
        candidate !== undefined &&
        start <= candidate.start &&
        candidate.start <= candidate.end &&
        candidate.end <= end
    );
    const selectionRange = contained ?? { start, end: start };
    const symbol = new vscode.DocumentSymbol(
      name.trim() ? name : "(anonymous)",
      detail,
      kind,
      this.toRange(start, end),
      this.toRange(selectionRange.start, selectionRange.end)
    );
    symbol.children = [];
    return symbol;
  }

  private clamp(offset: number): number {
    return Math.min(Math.max(offset, 0), this.textLength);
  }

  private toRange(start: number, end: number): vscode.Range {
    return new vscode.Range(this.document.positionAt(start), this.document.positionAt(end));
  }
}

function stageName(block: JenkinsfileBlock): string {
  const name = block.name === undefined ? "" : collapseWhitespace(block.name);
  if (!name) {
    return "stage";
  }
  return block.nameKind === "expression" ? `stage(${name})` : name;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
