import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "airizom.jenkins-workbench";

describe("extension smoke", () => {
  it("is present in the extension host", () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} not found`);
  });

  it("activates without throwing", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  it("registers its contributed commands", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();

    const registered = new Set(await vscode.commands.getCommands(true));
    const expected = [
      "jenkinsWorkbench.addEnvironment",
      "jenkinsWorkbench.removeEnvironment",
      "jenkinsWorkbench.triggerBuild",
      "jenkinsWorkbench.abortBuild"
    ];
    const missing = expected.filter((command) => !registered.has(command));
    assert.deepEqual(missing, [], `commands not registered: ${missing.join(", ")}`);
  });
});
