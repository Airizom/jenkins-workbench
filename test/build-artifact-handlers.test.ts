import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactTreeItem } from "../src/tree/TreeItems";
import * as vscodeStub from "./helpers/vscodeStub";

const showInformationMessage = vi.fn(async (_message: string) => undefined);
vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: { showInformationMessage }
}));

const { downloadAllArtifacts, downloadArtifact, previewArtifact } = await import(
  "../src/commands/build/BuildArtifactHandlers"
);

beforeEach(() => vi.clearAllMocks());

describe("build artifact commands", () => {
  it("contributes an archive action for running and completed build context menus", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const command = manifest.contributes.commands.find(
      (entry: { command: string }) => entry.command === "jenkinsWorkbench.downloadAllArtifacts"
    );
    const menu = manifest.contributes.menus["view/item/context"].find(
      (entry: { command: string }) => entry.command === "jenkinsWorkbench.downloadAllArtifacts"
    );

    expect(command.title).toBe("Download All Artifacts as ZIP");
    expect(menu.when).toBe(
      "view == jenkinsWorkbench.tree && viewItem =~ /(^|\\s)(build|buildRunning)(\\s|$)/"
    );
    expect(menu.group).toBe("1_actions@3");
  });

  it("requires a build selection for archive downloads", async () => {
    const handle = vi.fn(async () => undefined);

    await downloadAllArtifacts({ handle });

    expect(handle).not.toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalledWith(
      "Select a build to download all artifacts as ZIP."
    );
  });

  it.each([
    [previewArtifact, "preview"],
    [downloadArtifact, "download"]
  ] as const)("preserves individual artifact action %s", async (command, action) => {
    const handle = vi.fn(async () => undefined);
    const item = {
      environment: {
        environmentId: "test",
        scope: "workspace",
        url: "https://jenkins.example/"
      },
      buildUrl: "https://jenkins.example/job/demo/42/",
      buildNumber: 42,
      relativePath: "logs/output.txt",
      fileName: "output.txt",
      jobNameHint: "demo"
    } as ArtifactTreeItem;

    await command({ handle }, item);

    expect(handle).toHaveBeenCalledWith({ action, ...item });
  });
});
