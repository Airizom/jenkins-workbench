import * as assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import * as vscode from "vscode";

const CATEGORIES = ["enabled", "failure", "recovery", "completion", "pendingInput", "watchError"];
const SECTION = "jenkinsWorkbench";

describe("watch notification settings in the extension host", () => {
  it("contributes all six enabled-by-default window settings", () => {
    const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
    assert.ok(extension);
    const properties = extension.packageJSON.contributes.configuration.properties as Record<
      string,
      { type: string; default: unknown; scope: string }
    >;
    for (const category of CATEGORIES) {
      const key = `watchNotifications.${category}`;
      assert.deepEqual(
        {
          type: properties[`${SECTION}.${key}`].type,
          default: properties[`${SECTION}.${key}`].default,
          scope: properties[`${SECTION}.${key}`].scope
        },
        { type: "boolean", default: true, scope: "window" }
      );
      assert.equal(vscode.workspace.getConfiguration(SECTION).inspect(key)?.defaultValue, true);
    }
  });

  it("reads user and workspace overrides live without recreating the provider", async () => {
    const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
    assert.ok(extension);
    const { getExtensionConfiguration, getWatchNotificationOptions } = await import(
      vscode.Uri.joinPath(
        extension.extensionUri,
        "out-test",
        "host",
        "extension",
        "ExtensionConfig.js"
      ).fsPath
    );
    const getOptions = () => getWatchNotificationOptions(getExtensionConfiguration());
    const keys = ["watchNotifications.enabled", "watchNotifications.completion"];
    const config = () => vscode.workspace.getConfiguration(SECTION);
    const originals = keys.map((key) => ({ key, values: config().inspect<boolean>(key) }));
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "a workspace is required to verify workspace overrides");
    const settingsPath = (
      vscode.workspace.workspaceFile ?? vscode.Uri.joinPath(folder.uri, ".vscode", "settings.json")
    ).fsPath;
    const settingsBefore = await readFile(settingsPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });

    try {
      for (const key of keys) {
        await config().update(key, undefined, vscode.ConfigurationTarget.Workspace);
        await config().update(key, false, vscode.ConfigurationTarget.Global);
      }
      assert.equal(getOptions().enabled, false);
      assert.equal(getOptions().completion, false);

      for (const key of keys) {
        await config().update(key, true, vscode.ConfigurationTarget.Workspace);
      }
      assert.equal(getOptions().enabled, true, "workspace setting overrides the user mute");
      assert.equal(getOptions().completion, true);

      await config().update(
        "watchNotifications.enabled",
        false,
        vscode.ConfigurationTarget.Workspace
      );
      assert.equal(getOptions().enabled, false, "existing provider observes subsequent changes");
      assert.equal(getOptions().completion, true, "muting preserves category preferences");

      await config().update(
        "watchNotifications.enabled",
        true,
        vscode.ConfigurationTarget.Workspace
      );
      await config().update(
        "watchNotifications.completion",
        false,
        vscode.ConfigurationTarget.Workspace
      );
      assert.equal(getOptions().enabled, true);
      assert.equal(getOptions().completion, false, "category changes are read live too");
    } finally {
      try {
        for (const { key, values } of originals) {
          await config().update(key, values?.globalValue, vscode.ConfigurationTarget.Global);
          await config().update(key, values?.workspaceValue, vscode.ConfigurationTarget.Workspace);
        }
      } finally {
        // VS Code may reformat settings while updating keys; preserve the user's exact file.
        if (settingsBefore) {
          await writeFile(settingsPath, settingsBefore);
        } else {
          await unlink(settingsPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
      }
    }
  });
});
