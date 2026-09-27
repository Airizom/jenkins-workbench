import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
      "jenkinsWorkbench.openJobHistory",
      "jenkinsWorkbench.addEnvironment",
      "jenkinsWorkbench.removeEnvironment",
      "jenkinsWorkbench.triggerBuild",
      "jenkinsWorkbench.abortBuild",
      "jenkinsWorkbench.configureBuildDiagnostics",
      "jenkinsWorkbench.refreshBuildDiagnostics",
      "jenkinsWorkbench.showBuildDiagnosticOutput"
    ];
    const missing = expected.filter((command) => !registered.has(command));
    assert.deepEqual(missing, [], `commands not registered: ${missing.join(", ")}`);
  });

  it("registers the Jenkins task provider", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();

    const tasks = await vscode.tasks.fetchTasks({ type: "jenkinsWorkbench" });
    assert.ok(Array.isArray(tasks));
  });
  it("packages all five webview entries", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const manifest = JSON.parse(
      await readFile(
        vscode.Uri.joinPath(extension.extensionUri, "out", "webview", "manifest.json").fsPath,
        "utf8"
      )
    ) as Record<string, { file: string; isEntry?: boolean }>;
    for (const name of [
      "buildDetails",
      "buildCompare",
      "nodeDetails",
      "nodeCapacity",
      "jobHistory"
    ]) {
      assert.ok(
        Object.values(manifest).some((entry) => entry.isEntry && entry.file.startsWith(`${name}/`)),
        `missing webview ${name}`
      );
    }
  });
});
