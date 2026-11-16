import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeclaredEnvironment } from "../src/environments/sharing/DeclaredEnvironmentSource";
import type { EnvironmentDeclaration } from "../src/environments/sharing/EnvironmentDeclaration";
import type { EnvironmentScope, JenkinsEnvironment } from "../src/storage/JenkinsEnvironmentStore";
import * as vscodeStub from "./helpers/vscodeStub";

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

const settings = {
  globalValue: undefined as unknown,
  workspaceValue: undefined as unknown,
  // The merged value must never be written back.
  value: [{ id: "merged-only", url: "https://merged.example/" }] as unknown,
  updates: [] as Array<{ key: string; value: unknown; target: number }>
};

const workspace = {
  workspaceFolders: [{ uri: vscodeStub.Uri.file("/repo"), name: "repo", index: 0 }] as
    | unknown[]
    | undefined,
  workspaceFile: undefined as unknown,
  getConfiguration: (section: string) => {
    expect(section).toBe("jenkinsWorkbench");
    return {
      inspect: (key: string) => {
        expect(key).toBe("environments");
        return {
          key: "jenkinsWorkbench.environments",
          globalValue: settings.globalValue,
          workspaceValue: settings.workspaceValue
        };
      },
      get: () => settings.value,
      update: async (key: string, value: unknown, target: number) => {
        settings.updates.push({ key, value, target });
      }
    };
  }
};

vi.doMock("vscode", () => ({ ...vscodeStub, ConfigurationTarget, workspace }));

const { EnvironmentSettingsWriter } = await import(
  "../src/environments/sharing/EnvironmentSettingsWriter"
);

const declared: DeclaredEnvironment[] = [];
const stored: Record<EnvironmentScope, JenkinsEnvironment[]> = { workspace: [], global: [] };

function createWriter() {
  return new EnvironmentSettingsWriter({
    source: { getDeclared: (scope) => declared.filter((entry) => entry.scope === scope) },
    store: { getEnvironments: async (scope) => stored[scope] }
  });
}

const CI: EnvironmentDeclaration = {
  id: "ci",
  url: "https://ci.example/",
  name: "CI",
  auth: { type: "basic" }
};

beforeEach(() => {
  settings.globalValue = undefined;
  settings.workspaceValue = undefined;
  settings.updates = [];
  workspace.workspaceFolders = [{ uri: vscodeStub.Uri.file("/repo"), name: "repo", index: 0 }];
  workspace.workspaceFile = undefined;
  declared.length = 0;
  stored.workspace = [];
  stored.global = [];
});

describe("EnvironmentSettingsWriter", () => {
  it("appends to the user level value from inspect, keeping unknown entries untouched", async () => {
    const unknownEntry = { id: "weird", url: 42, extra: { nested: true } };
    settings.globalValue = [unknownEntry, "not-an-object"];
    settings.workspaceValue = [{ id: "team", url: "https://team.example/" }];

    const result = await createWriter().appendDeclarations("user", [CI]);

    expect(result.added).toEqual([CI]);
    expect(result.skipped).toEqual([]);
    expect(settings.updates).toEqual([
      {
        key: "environments",
        value: [unknownEntry, "not-an-object", CI],
        target: ConfigurationTarget.Global
      }
    ]);
    expect(settings.updates[0]?.value).not.toContainEqual(
      expect.objectContaining({ id: "merged-only" })
    );
  });

  it("writes to workspace settings with the workspace target", async () => {
    settings.globalValue = [{ id: "mine", url: "https://mine.example/" }];

    await createWriter().appendDeclarations("workspace", [CI]);

    expect(settings.updates).toEqual([
      { key: "environments", value: [CI], target: ConfigurationTarget.Workspace }
    ]);
  });

  it("skips ids and URLs already at that level, declared elsewhere, or stored", async () => {
    settings.workspaceValue = [{ id: "ci", url: "https://other.example/" }];
    settings.globalValue = [{ id: "user-only", url: "https://user.example/" }];
    declared.push({
      scope: "global",
      slug: "declared",
      id: "settings:declared",
      url: "https://declared.example/",
      origin: { level: "user" }
    });
    stored.global = [{ id: "uuid-1", url: "https://stored.example", name: "Stored" }];

    const result = await createWriter().appendDeclarations("workspace", [
      CI,
      { id: "fresh", url: "https://OTHER.example" },
      { id: "declared", url: "https://new.example/" },
      { id: "dup-url", url: "https://declared.example/" },
      { id: "stored-dup", url: "https://stored.example/" },
      { id: "ok", url: "https://ok.example/" },
      { id: "ok", url: "https://ok-again.example/" },
      { id: "ok-2", url: "https://ok.example/" }
    ]);

    expect(result.added.map((entry) => entry.id)).toEqual(["ok"]);
    expect(
      Object.fromEntries(result.skipped.map((entry) => [entry.declaration.id, entry.reason]))
    ).toMatchInlineSnapshot(`
      {
        "ci": ""ci" is already in workspace settings",
        "declared": ""declared" is already declared in settings",
        "dup-url": "https://declared.example/ is already shared as "declared"",
        "fresh": "https://other.example/ is already in workspace settings as "ci"",
        "ok": ""ok" appears more than once",
        "ok-2": "https://ok.example/ appears more than once",
        "stored-dup": "https://stored.example/ already has an environment (Stored)",
      }
    `);
    expect(settings.updates[0]?.value).toEqual([
      { id: "ci", url: "https://other.example/" },
      { id: "ok", url: "https://ok.example/" }
    ]);
  });

  it("ignores the manual environment being shared when checking stored URLs", async () => {
    stored.workspace = [{ id: "manual", url: "https://ci.example/" }];

    const writer = createWriter();
    const blocked = await writer.appendDeclarations("user", [CI]);
    const allowed = await writer.appendDeclarations("user", [CI], {
      ignoreStored: [{ scope: "workspace", id: "manual" }]
    });

    expect(blocked.added).toEqual([]);
    expect(allowed.added).toEqual([CI]);
  });

  it("strips allowInsecureTls for workspace settings and reports it", async () => {
    const insecure = { ...CI, allowInsecureTls: true };

    const workspaceResult = await createWriter().appendDeclarations("workspace", [insecure]);
    expect(workspaceResult.insecureTlsDropped).toEqual(["ci"]);
    expect(settings.updates[0]?.value).toEqual([CI]);

    settings.updates = [];
    const userResult = await createWriter().appendDeclarations("user", [insecure]);
    expect(userResult.insecureTlsDropped).toEqual([]);
    expect(settings.updates[0]?.value).toEqual([insecure]);
  });

  it("requires an open workspace for the workspace target", async () => {
    workspace.workspaceFolders = undefined;

    await expect(createWriter().appendDeclarations("workspace", [CI])).rejects.toThrow(
      /Open a folder or workspace/
    );
    expect(settings.updates).toEqual([]);
  });

  it("refuses to replace a level value that is not a list", async () => {
    settings.globalValue = { id: "ci" };

    await expect(createWriter().appendDeclarations("user", [CI])).rejects.toThrow(/not a list/);
    expect(settings.updates).toEqual([]);
  });

  it("does not write when everything is skipped", async () => {
    settings.globalValue = [CI];

    const result = await createWriter().appendDeclarations("user", [CI]);

    expect(result.added).toEqual([]);
    expect(settings.updates).toEqual([]);
  });

  it("lists taken ids from the level value and visible declarations", () => {
    settings.workspaceValue = [{ id: "team", url: "https://team.example/" }];
    declared.push({
      scope: "global",
      slug: "mine",
      id: "settings:mine",
      url: "https://mine.example/",
      origin: { level: "user" }
    });

    expect([...createWriter().getTakenIds("workspace")].sort()).toEqual(["mine", "team"]);
  });
});
