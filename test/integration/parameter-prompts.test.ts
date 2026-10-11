import * as assert from "node:assert/strict";
import * as vscode from "vscode";

interface ParameterPrompts {
  promptBooleanParameterValue(prompt: string, defaultValue: boolean): Promise<string | undefined>;
  promptChoiceParameterValue(
    prompt: string,
    choices: string[],
    defaultValue: string
  ): Promise<string | undefined>;
}

async function loadPrompts(): Promise<ParameterPrompts> {
  const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
  assert.ok(extension);
  return import(
    vscode.Uri.joinPath(extension.extensionUri, "out-test", "host", "ui", "ParameterPrompts.js")
      .fsPath
  );
}

async function acceptInitialSelection(pending: Promise<string | undefined>) {
  // Retry Enter until the picker has reached the workbench across the extension-host IPC.
  const accept = setInterval(() => {
    void vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  }, 100);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Parameter prompt did not accept")), 5000);
      })
    ]);
  } finally {
    clearInterval(accept);
    clearTimeout(timeout);
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  }
}

describe("parameter prompt defaults", () => {
  it("accepts a false boolean default without navigation", async () => {
    const { promptBooleanParameterValue } = await loadPrompts();
    assert.equal(
      await acceptInitialSelection(promptBooleanParameterValue("Boolean default", false)),
      "false"
    );
  });

  it("accepts a non-first choice default without navigation", async () => {
    const { promptChoiceParameterValue } = await loadPrompts();
    assert.equal(
      await acceptInitialSelection(
        promptChoiceParameterValue("Choice default", ["first", "second"], "second")
      ),
      "second"
    );
  });
});
