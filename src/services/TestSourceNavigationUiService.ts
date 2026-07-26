import * as vscode from "vscode";
import type {
  TestSourceNavigationContext,
  TestSourceNavigationTarget,
  TestSourceResolver
} from "./TestSourceResolver";

export class TestSourceNavigationUiService {
  constructor(private readonly resolver: TestSourceResolver) {}

  async openTestSource(
    context: TestSourceNavigationContext,
    target: TestSourceNavigationTarget
  ): Promise<void> {
    const resolution = await this.resolver.resolve(context, target);
    switch (resolution.kind) {
      case "missingClassName":
        void vscode.window.showInformationMessage(
          `No source location is available for ${target.testName}.`
        );
        return;
      case "missingRepositoryLink":
        void vscode.window.showInformationMessage(
          "Link the matching workspace repository to this Jenkins multibranch job to open test sources."
        );
        return;
      case "noMatches":
        void vscode.window.showInformationMessage(
          `No matching source file was found for ${target.testName}.`
        );
        return;
      case "matches": {
        if (resolution.matches.length === 1) {
          await this.openSource(resolution.matches[0]);
          return;
        }
        const selected = await this.resolveSelection(resolution.matches, target);
        if (!selected) {
          return;
        }
        await this.openSource(selected);
      }
    }
  }

  private async resolveSelection(
    matches: readonly vscode.Uri[],
    target: TestSourceNavigationTarget
  ): Promise<vscode.Uri | undefined> {
    const picks = matches.map((uri) => ({
      label: vscode.workspace.asRelativePath(uri, false),
      description: uri.fsPath,
      uri
    }));
    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: `Select the source file for ${target.testName}`
    });
    return selected?.uri;
  }

  private async openSource(uri: vscode.Uri): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.Active
    });
  }
}
