import assert from "node:assert/strict";
import type { CodeActionContext, Range, TextDocument } from "vscode";
import { describe, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

class TestWorkspaceEdit {
  insertions: Array<{ position: vscodeStub.Position; text: string }> = [];

  insert(_uri: vscodeStub.Uri, position: vscodeStub.Position, text: string): void {
    this.insertions.push({ position, text });
  }
}

class TestCodeAction {
  edit?: TestWorkspaceEdit;

  constructor(
    readonly title: string,
    readonly kind: string
  ) {}
}

class TestCodeLens {
  constructor(readonly range: vscodeStub.Range) {}
}

vi.doMock("vscode", () => ({
  ...vscodeStub,
  CodeAction: TestCodeAction,
  CodeActionKind: { QuickFix: "quickfix" },
  CodeLens: TestCodeLens,
  WorkspaceEdit: TestWorkspaceEdit
}));

const { JenkinsfileQuickFixProvider } = await import(
  "../src/validation/editor/JenkinsfileQuickFixProvider"
);
const { JenkinsfileValidationCodeLensProvider } = await import(
  "../src/validation/editor/JenkinsfileValidationCodeLensProvider"
);

describe("Jenkinsfile providers with a commented-out pipeline", () => {
  it("places the missing-agent edit and CodeLens on the real pipeline", () => {
    const lines = ["/*", "pipeline {", "}", "*/", "pipeline {", "  stages {}", "}"];
    const document = {
      uri: vscodeStub.Uri.file("/Jenkinsfile"),
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line] })
    } as unknown as TextDocument;
    const matcher = { matches: () => true } as unknown as ConstructorParameters<
      typeof JenkinsfileQuickFixProvider
    >[0];
    const diagnostic = new vscodeStub.Diagnostic(new vscodeStub.Range(4, 0, 4, 8), "Missing agent");
    diagnostic.source = "jenkins";
    diagnostic.code = "missing-agent";

    const actions = new JenkinsfileQuickFixProvider(matcher).provideCodeActions(
      document,
      diagnostic.range as unknown as Range,
      { diagnostics: [diagnostic] } as unknown as CodeActionContext
    );
    assert.equal(actions.length, 2);
    const insertion = (actions[0].edit as unknown as TestWorkspaceEdit).insertions[0];
    assert.equal(insertion.position.line, 5);
    assert.match(insertion.text, /agent any/);

    const statusProvider = {
      onDidChangeValidationStatus: () => undefined,
      getValidationState: () => undefined
    } as unknown as ConstructorParameters<typeof JenkinsfileValidationCodeLensProvider>[1];
    const codeLensProvider = new JenkinsfileValidationCodeLensProvider(matcher, statusProvider);
    const lenses = codeLensProvider.provideCodeLenses(document);
    assert.equal(lenses.length, 1);
    assert.equal(lenses[0].range.start.line, 4);
    codeLensProvider.dispose();
  });

  it("does not offer duplicate section fixes after a differently indented comment", () => {
    const lines = [
      "pipeline {",
      "    // note",
      "    options {}",
      "  agent any",
      "      stages {}",
      "}"
    ];
    const document = {
      uri: vscodeStub.Uri.file("/Jenkinsfile"),
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line] })
    } as unknown as TextDocument;
    const matcher = { matches: () => true } as unknown as ConstructorParameters<
      typeof JenkinsfileQuickFixProvider
    >[0];
    const provider = new JenkinsfileQuickFixProvider(matcher);

    for (const code of ["missing-agent", "missing-stages"]) {
      const diagnostic = new vscodeStub.Diagnostic(new vscodeStub.Range(0, 0, 0, 8), code);
      diagnostic.source = "jenkins";
      diagnostic.code = code;
      const actions = provider.provideCodeActions(
        document,
        diagnostic.range as unknown as Range,
        { diagnostics: [diagnostic] } as unknown as CodeActionContext
      );
      assert.equal(actions.length, 0, code);
    }
  });
});
