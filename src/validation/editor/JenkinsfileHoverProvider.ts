import * as vscode from "vscode";

export class JenkinsfileHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly validationHoverProvider: vscode.HoverProvider,
    private readonly stepHoverProvider: vscode.HoverProvider
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const [validationHover, stepHover] = await Promise.all([
      this.validationHoverProvider.provideHover(document, position, token),
      this.stepHoverProvider.provideHover(document, position, token)
    ]);

    return mergeHovers(position, [validationHover, stepHover]);
  }
}

function mergeHovers(
  position: vscode.Position,
  hovers: ReadonlyArray<vscode.Hover | null | undefined>
): vscode.Hover | undefined {
  const matching = collectMatchingHovers(hovers, position);
  if (matching.length === 0) {
    return undefined;
  }
  if (matching.length === 1) {
    return matching[0];
  }

  const contents = matching.flatMap((hover, index) => {
    const entries = normalizeHoverContents(hover.contents);
    if (index === 0 || entries.length === 0) {
      return entries;
    }
    return [new vscode.MarkdownString("---"), ...entries];
  });

  return new vscode.Hover(contents, mergeHoverRange(position, matching));
}

function collectMatchingHovers(
  hovers: ReadonlyArray<vscode.Hover | null | undefined>,
  position: vscode.Position
): vscode.Hover[] {
  return hovers.filter(
    (hover): hover is vscode.Hover =>
      hover !== undefined && hover !== null && hoverMatches(hover, position)
  );
}

function hoverMatches(hover: vscode.Hover, position: vscode.Position): boolean {
  return !hover.range || hover.range.contains(position);
}

function mergeHoverRange(
  position: vscode.Position,
  hovers: ReadonlyArray<vscode.Hover>
): vscode.Range | undefined {
  const containingRanges = hovers
    .map((hover) => hover.range)
    .filter((range): range is vscode.Range => range?.contains(position) === true);
  return containingRanges.reduce<vscode.Range | undefined>((smallestRange, currentRange) => {
    if (!smallestRange || rangeSpan(currentRange) < rangeSpan(smallestRange)) {
      return currentRange;
    }
    return smallestRange;
  }, undefined);
}

function normalizeHoverContents(contents: vscode.Hover["contents"]): vscode.MarkdownString[] {
  const entries = Array.isArray(contents) ? contents : [contents];
  return entries.map((entry) => {
    if (entry instanceof vscode.MarkdownString) {
      return entry;
    }
    if (typeof entry === "string") {
      return new vscode.MarkdownString(entry);
    }
    const language = entry.language?.trim();
    const value = language ? `\`\`\`${language}\n${entry.value}\n\`\`\`` : `\`${entry.value}\``;
    return new vscode.MarkdownString(value);
  });
}

function rangeSpan(range: vscode.Range): number {
  return (
    (range.end.line - range.start.line) * 1_000_000 + (range.end.character - range.start.character)
  );
}
