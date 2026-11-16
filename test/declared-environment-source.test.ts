import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

const { EventEmitter, Uri } = vscodeStub;

interface FakeFolder {
  uri: vscodeStub.Uri;
  name: string;
  index: number;
}

const settings = {
  user: undefined as unknown,
  workspace: undefined as unknown,
  folders: new Map<string, unknown>()
};
const configurationEvents = new EventEmitter<{ affectsConfiguration(section: string): boolean }>();
const trustEvents = new EventEmitter<void>();
const folderEvents = new EventEmitter<unknown>();
const warnings: string[] = [];

const workspace = {
  isTrusted: true,
  workspaceFolders: undefined as FakeFolder[] | undefined,
  getConfiguration(section: string, scope?: vscodeStub.Uri) {
    expect(section).toBe("jenkinsWorkbench");
    return {
      inspect(key: string) {
        expect(key).toBe("environments");
        return {
          key: "jenkinsWorkbench.environments",
          globalValue: settings.user,
          workspaceValue: settings.workspace,
          workspaceFolderValue: scope ? settings.folders.get(scope.toString()) : undefined
        };
      }
    };
  },
  onDidChangeConfiguration: configurationEvents.event,
  onDidGrantWorkspaceTrust: trustEvents.event,
  onDidChangeWorkspaceFolders: folderEvents.event
};

vi.doMock("vscode", () => ({
  ...vscodeStub,
  workspace,
  window: {
    showWarningMessage: async (message: string) => {
      warnings.push(message);
      return undefined;
    }
  },
  commands: { executeCommand: async () => undefined }
}));

const { DeclaredEnvironmentSource } = await import(
  "../src/environments/sharing/DeclaredEnvironmentSource"
);

function folder(name: string, index = 0): FakeFolder {
  return { uri: Uri.file(`/work/${name}`), name, index };
}

const sources: Array<{ dispose(): void }> = [];

function createSource() {
  const lines: string[] = [];
  const source = new DeclaredEnvironmentSource({ log: { appendLine: (line) => lines.push(line) } });
  sources.push(source);
  return { source, lines };
}

function fireConfigurationChange(section = "jenkinsWorkbench.environments"): void {
  configurationEvents.fire({ affectsConfiguration: (candidate) => candidate === section });
}

beforeEach(() => {
  settings.user = undefined;
  settings.workspace = undefined;
  settings.folders.clear();
  workspace.isTrusted = true;
  workspace.workspaceFolders = undefined;
  warnings.length = 0;
});

afterEach(() => {
  for (const source of sources.splice(0)) {
    source.dispose();
  }
});

describe("DeclaredEnvironmentSource levels", () => {
  it("maps user settings to global and workspace/folder settings to workspace", () => {
    const app = folder("app");
    workspace.workspaceFolders = [app];
    settings.user = [{ id: "personal", url: "https://personal.example" }];
    settings.workspace = [{ id: "team", url: "https://team.example", auth: { type: "basic" } }];
    settings.folders.set(app.uri.toString(), [{ id: "app", url: "https://app.example" }]);

    const { source } = createSource();

    expect(source.getDeclared("global")).toEqual([
      {
        scope: "global",
        slug: "personal",
        id: "settings:personal",
        url: "https://personal.example/",
        origin: { level: "user" }
      }
    ]);
    expect(source.getDeclared("workspace")).toEqual([
      {
        scope: "workspace",
        slug: "team",
        id: "settings:team",
        url: "https://team.example/",
        authHint: { type: "basic" },
        origin: { level: "workspace" }
      },
      {
        scope: "workspace",
        slug: "app",
        id: "settings:app",
        url: "https://app.example/",
        origin: { level: "folder", folderUri: app.uri.toString() }
      }
    ]);
    expect(source.getDeclaration("workspace", "settings:app")?.slug).toBe("app");
    expect(source.getDeclaration("global", "settings:app")).toBeUndefined();
    expect(source.getProblems()).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("ignores workspace and folder settings in untrusted workspaces", () => {
    const app = folder("app");
    workspace.workspaceFolders = [app];
    workspace.isTrusted = false;
    settings.user = [{ id: "personal", url: "https://personal.example" }];
    settings.workspace = [{ id: "team", url: "not a url" }];
    settings.folders.set(app.uri.toString(), [{ id: "app", url: "https://app.example" }]);

    const { source } = createSource();

    expect(source.getDeclared("workspace")).toEqual([]);
    expect(source.getDeclared("global").map((entry) => entry.id)).toEqual(["settings:personal"]);
    expect(source.getProblems()).toEqual([]);
  });

  it("honors allowInsecureTls only from user settings", () => {
    settings.user = [{ id: "personal", url: "https://personal.example", allowInsecureTls: true }];
    settings.workspace = [{ id: "team", url: "https://team.example", allowInsecureTls: true }];

    const { source, lines } = createSource();

    expect(source.getDeclaration("global", "settings:personal")?.allowInsecureTls).toBe(true);
    expect(source.getDeclaration("workspace", "settings:team")).not.toHaveProperty(
      "allowInsecureTls"
    );
    expect(source.getProblems()).toEqual([
      expect.stringContaining('"allowInsecureTls" is only honored in user settings')
    ]);
    expect(lines.join("\n")).toContain("allowInsecureTls");
    expect(warnings).toHaveLength(1);
  });

  it("applies the user's own allowInsecureTls to a workspace entry with the same id and origin", () => {
    settings.user = [
      { id: "team", url: "https://team.example/other-path", allowInsecureTls: true },
      { id: "elsewhere", url: "https://elsewhere.example", allowInsecureTls: true }
    ];
    settings.workspace = [
      { id: "team", url: "https://team.example/jenkins", allowInsecureTls: true },
      { id: "elsewhere", url: "https://moved.example" },
      { id: "plain", url: "https://plain.example" }
    ];

    const { source } = createSource();

    expect(source.getDeclaration("workspace", "settings:team")?.allowInsecureTls).toBe(true);
    // Same id but another server: the user's opt-in does not carry over.
    expect(source.getDeclaration("workspace", "settings:elsewhere")).not.toHaveProperty(
      "allowInsecureTls"
    );
    expect(source.getDeclaration("workspace", "settings:plain")).not.toHaveProperty(
      "allowInsecureTls"
    );
    // The shadowed user entries are dropped, and the opt-in silences the workspace warning.
    expect(source.getDeclared("global")).toEqual([]);
    expect(source.getProblems()).toEqual([]);
  });

  it("does not take allowInsecureTls from a user entry with another id on the same server", () => {
    settings.user = [{ id: "mine", url: "https://team.example", allowInsecureTls: true }];
    settings.workspace = [{ id: "team", url: "https://team.example" }];

    const { source } = createSource();

    expect(source.getDeclaration("workspace", "settings:team")).not.toHaveProperty(
      "allowInsecureTls"
    );
  });

  it("dedupes the identical value reported for workspace and its single folder", () => {
    const app = folder("app");
    workspace.workspaceFolders = [app];
    const value = [{ id: "team", url: "https://team.example", allowInsecureTls: true }];
    settings.workspace = value;
    settings.folders.set(app.uri.toString(), structuredClone(value));

    const { source } = createSource();

    expect(source.getDeclared("workspace")).toHaveLength(1);
    expect(source.getDeclared("workspace")[0].origin).toEqual({ level: "workspace" });
    // One problem for allowInsecureTls, not one per level.
    expect(source.getProblems()).toHaveLength(1);
  });

  it("keeps the first of conflicting duplicates in a scope and reports the rest", () => {
    const first = folder("first", 0);
    const second = folder("second", 1);
    workspace.workspaceFolders = [first, second];
    settings.folders.set(first.uri.toString(), [{ id: "team", url: "https://a.example" }]);
    settings.folders.set(second.uri.toString(), [
      { id: "team", url: "https://b.example" },
      { id: "same-server", url: "https://A.example/" },
      { id: "team", url: "https://a.example/" }
    ]);

    const { source } = createSource();

    expect(source.getDeclared("workspace")).toEqual([
      expect.objectContaining({ id: "settings:team", url: "https://a.example/" })
    ]);
    const problems = source.getProblems();
    expect(problems).toEqual([
      // Reported by the parser: the folder repeats "team" within its own list.
      expect.stringContaining('Folder settings (second) entry 3: id "team"'),
      expect.stringContaining('Folder settings (second): id "team"'),
      expect.stringContaining('already declared as "team"')
    ]);
  });

  it("lets workspace declarations shadow user declarations by slug or URL", () => {
    settings.user = [
      { id: "team", url: "https://old-team.example" },
      { id: "personal-copy", url: "https://CI.example/" },
      { id: "personal", url: "https://personal.example" }
    ];
    settings.workspace = [
      { id: "team", url: "https://team.example" },
      { id: "ci", url: "https://ci.example" }
    ];

    const { source } = createSource();

    expect(source.getDeclared("global").map((entry) => entry.id)).toEqual(["settings:personal"]);
    expect(source.getDeclared("workspace").map((entry) => entry.id)).toEqual([
      "settings:team",
      "settings:ci"
    ]);
    expect(source.getProblems()).toEqual([]);
  });
});

describe("DeclaredEnvironmentSource changes", () => {
  it("re-reads on relevant configuration changes and fires only when declarations differ", () => {
    settings.user = [{ id: "ci", url: "https://ci.example" }];
    const { source } = createSource();
    const listener = vi.fn();
    source.onDidChange(listener);
    expect(source.getDeclared("global")).toHaveLength(1);

    settings.user = [{ id: "ci", url: "https://ci2.example" }];
    fireConfigurationChange("jenkinsWorkbench.pollIntervalSeconds");
    expect(listener).not.toHaveBeenCalled();
    expect(source.getDeclared("global")[0].url).toBe("https://ci.example/");

    fireConfigurationChange();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.getDeclared("global")[0].url).toBe("https://ci2.example/");

    fireConfigurationChange();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("re-reads when workspace trust is granted", () => {
    workspace.isTrusted = false;
    settings.workspace = [{ id: "team", url: "https://team.example" }];
    const { source } = createSource();
    const listener = vi.fn();
    source.onDidChange(listener);
    expect(source.getDeclared("workspace")).toEqual([]);

    workspace.isTrusted = true;
    trustEvents.fire();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.getDeclared("workspace").map((entry) => entry.id)).toEqual(["settings:team"]);
  });

  it("re-reads when workspace folders change", () => {
    const { source } = createSource();
    const listener = vi.fn();
    source.onDidChange(listener);
    expect(source.getDeclared("workspace")).toEqual([]);

    const app = folder("app");
    workspace.workspaceFolders = [app];
    settings.folders.set(app.uri.toString(), [{ id: "app", url: "https://app.example" }]);
    folderEvents.fire({});

    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.getDeclared("workspace")).toHaveLength(1);
  });

  it("warns once per distinct problem set", () => {
    settings.user = [{ id: "bad id", url: "https://ci.example" }];
    const { source } = createSource();
    source.getDeclared("global");
    expect(warnings).toHaveLength(1);

    settings.user = [
      { id: "bad id", url: "https://ci.example" },
      { id: "ok", url: "x" }
    ];
    fireConfigurationChange();
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("2 problems");

    fireConfigurationChange();
    expect(warnings).toHaveLength(2);
  });

  it("stops listening once disposed", () => {
    const { source } = createSource();
    const listener = vi.fn();
    source.onDidChange(listener);
    source.dispose();
    settings.user = [{ id: "ci", url: "https://ci.example" }];
    fireConfigurationChange();
    expect(listener).not.toHaveBeenCalled();
  });
});
