import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeclaredEnvironment } from "../src/environments/sharing/DeclaredEnvironmentSource";
import { parseEnvironmentDeclarations } from "../src/environments/sharing/EnvironmentDeclaration";
import { toDeclaredEnvironmentId } from "../src/storage/DeclaredEnvironmentView";
import type { JenkinsAuthConfig } from "../src/jenkins/types";
import type { AdoptionResult } from "../src/services/EnvironmentAdoptionService";
import type {
  EnvironmentScope,
  EnvironmentSignInRequirement,
  JenkinsEnvironment
} from "../src/storage/JenkinsEnvironmentStore";
import * as vscodeStub from "./helpers/vscodeStub";

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

interface MessageCall {
  kind: "info" | "warning" | "error";
  message: string;
  modal: boolean;
  items: string[];
}

const ui = {
  quickPicks: [] as Array<{ items: Array<Record<string, unknown>>; options: unknown }>,
  pick: [] as Array<(items: Array<Record<string, unknown>>) => unknown>,
  inputBoxes: [] as Array<{
    value?: string;
    validateInput?: (value: string) => string | undefined;
  }>,
  input: undefined as ((value: string | undefined) => string | undefined) | undefined,
  saveDialogs: [] as Array<{ defaultUri?: vscodeStub.Uri }>,
  saveUri: undefined as vscodeStub.Uri | undefined,
  openUri: undefined as vscodeStub.Uri | undefined,
  messages: [] as MessageCall[],
  respond: undefined as ((call: MessageCall) => string | undefined) | undefined,
  executed: [] as unknown[][],
  written: new Map<string, string>(),
  files: new Map<string, string>()
};

const events: string[] = [];

const settings = {
  globalValue: undefined as unknown,
  workspaceValue: undefined as unknown,
  /** When false, writes are not visible to the declared source (settings not reloaded yet). */
  autoLoad: true,
  loadedGlobal: undefined as unknown,
  loadedWorkspace: undefined as unknown
};

const sourceEmitter = new vscodeStub.EventEmitter<void>();

function splitMessageArgs(args: unknown[]): { modal: boolean; items: string[] } {
  const [first, ...rest] = args;
  if (first && typeof first === "object") {
    return { modal: (first as { modal?: boolean }).modal === true, items: rest as string[] };
  }
  return { modal: false, items: args as string[] };
}

function message(kind: MessageCall["kind"]) {
  return async (text: string, ...args: unknown[]) => {
    const call = { kind, message: text, ...splitMessageArgs(args) };
    ui.messages.push(call);
    return ui.respond?.(call);
  };
}

const workspace = {
  isTrusted: true,
  workspaceFolders: [{ uri: vscodeStub.Uri.file("/repo"), name: "repo", index: 0 }] as
    | unknown[]
    | undefined,
  workspaceFile: undefined as vscodeStub.Uri | undefined,
  getConfiguration: () => ({
    inspect: () => ({
      key: "jenkinsWorkbench.environments",
      globalValue: settings.globalValue,
      workspaceValue: settings.workspaceValue
    }),
    update: async (_key: string, value: unknown, target: number) => {
      const level = target === ConfigurationTarget.Workspace ? "workspace" : "user";
      events.push(`write ${level}`);
      if (level === "workspace") {
        settings.workspaceValue = value;
      } else {
        settings.globalValue = value;
      }
      if (settings.autoLoad) {
        settings.loadedGlobal = settings.globalValue;
        settings.loadedWorkspace = settings.workspaceValue;
        sourceEmitter.fire();
      }
    }
  }),
  fs: {
    writeFile: async (uri: vscodeStub.Uri, content: Uint8Array) => {
      ui.written.set(uri.path, new TextDecoder().decode(content));
    },
    readFile: async (uri: vscodeStub.Uri) => {
      const text = ui.files.get(uri.path);
      if (text === undefined) {
        throw new Error("ENOENT");
      }
      return new TextEncoder().encode(text);
    }
  }
};

const vscodeMock = {
  ...vscodeStub,
  ConfigurationTarget,
  workspace,
  commands: {
    executeCommand: async (...args: unknown[]) => {
      ui.executed.push(args);
      return undefined;
    }
  },
  window: {
    showQuickPick: async (items: Array<Record<string, unknown>>, options: unknown) => {
      ui.quickPicks.push({ items, options });
      return ui.pick.shift()?.(items);
    },
    showInputBox: async (options: {
      value?: string;
      validateInput?: (value: string) => string | undefined;
    }) => {
      ui.inputBoxes.push(options);
      return ui.input ? ui.input(options.value) : options.value;
    },
    showSaveDialog: async (options: { defaultUri?: vscodeStub.Uri }) => {
      ui.saveDialogs.push(options);
      return ui.saveUri;
    },
    showOpenDialog: async () => (ui.openUri ? [ui.openUri] : undefined),
    showInformationMessage: message("info"),
    showWarningMessage: message("warning"),
    showErrorMessage: message("error")
  }
};

const tls = {
  response: false as boolean | undefined,
  calls: [] as Array<{ placeHolder?: string }>
};

vi.doMock("vscode", () => vscodeMock);
vi.doMock("../src/commands/environment/EnvironmentPrompts", () => ({
  promptTlsCertificateValidation: async (
    _current?: boolean,
    options: { placeHolder?: string } = {}
  ) => {
    tls.calls.push(options);
    return tls.response;
  }
}));

const { EnvironmentSettingsWriter } = await import(
  "../src/environments/sharing/EnvironmentSettingsWriter"
);
const {
  EXPORT_FILE_NAME,
  exportEnvironments,
  importEnvironments,
  shareEnvironmentInSettings,
  validateSlug
} = await import("../src/commands/environment/EnvironmentSharingCommands");
const { dedupeSlug, resolveShareableAuthHint, toSlugCandidate } = await import(
  "../src/commands/environment/EnvironmentShareDeclarations"
);

function loadedDeclarations(scope: EnvironmentScope): DeclaredEnvironment[] {
  const value = scope === "global" ? settings.loadedGlobal : settings.loadedWorkspace;
  return parseEnvironmentDeclarations(value).valid.map((declaration) => ({
    scope,
    slug: declaration.id,
    id: toDeclaredEnvironmentId(declaration.id),
    url: declaration.url,
    ...(declaration.name ? { name: declaration.name } : {}),
    ...(declaration.allowInsecureTls && scope === "global" ? { allowInsecureTls: true } : {}),
    ...(declaration.auth ? { authHint: declaration.auth } : {}),
    origin: { level: scope === "global" ? "user" : "workspace" }
  }));
}

const extraDeclared: DeclaredEnvironment[] = [];

const source = {
  getDeclared: (scope: EnvironmentScope) => [
    ...extraDeclared.filter((entry) => entry.scope === scope),
    ...loadedDeclarations(scope)
  ],
  getDeclaration: (scope: EnvironmentScope, id: string) =>
    source.getDeclared(scope).find((entry) => entry.id === id),
  onDidChange: sourceEmitter.event
};

class FakeStore {
  stored: Record<EnvironmentScope, JenkinsEnvironment[]> = { workspace: [], global: [] };
  authConfigs = new Map<string, JenkinsAuthConfig>();
  added: Array<{ scope: EnvironmentScope; environment: JenkinsEnvironment }> = [];

  async getStoredEnvironments(scope: EnvironmentScope) {
    return [...this.stored[scope]];
  }

  async getEnvironments(scope: EnvironmentScope): Promise<JenkinsEnvironment[]> {
    return [
      ...this.stored[scope],
      ...source.getDeclared(scope).map((entry) => ({
        id: entry.id,
        url: entry.url,
        ...(entry.name ? { name: entry.name } : {}),
        ...(entry.allowInsecureTls ? { allowInsecureTls: true } : {}),
        ...(entry.authHint ? { authHint: entry.authHint } : {}),
        source: "settings" as const
      }))
    ];
  }

  async listEnvironmentsWithScope() {
    const scopes: EnvironmentScope[] = ["workspace", "global"];
    const lists = await Promise.all(
      scopes.map(async (scope) =>
        (await this.getEnvironments(scope)).map((environment) => ({ ...environment, scope }))
      )
    );
    return lists.flat();
  }

  async getAuthConfig(scope: EnvironmentScope, id: string) {
    return this.authConfigs.get(`${scope}:${id}`);
  }

  async addEnvironment(scope: EnvironmentScope, environment: JenkinsEnvironment) {
    this.added.push({ scope, environment });
    this.stored[scope].push(environment);
  }

  async getSignInRequirement(
    scope: EnvironmentScope,
    id: string
  ): Promise<EnvironmentSignInRequirement> {
    if (id.startsWith("settings:")) {
      return "confirm-origin";
    }
    const environment = this.stored[scope].find((entry) => entry.id === id);
    if (!environment?.authHint || environment.authHint.type === "none") {
      return "none";
    }
    return this.authConfigs.has(`${scope}:${id}`) ? "none" : "credentials";
  }
}

let store: FakeStore;
let adoptResult: AdoptionResult;
let adoptCalls: unknown[][];
const refreshes: unknown[] = [];
const logLines: string[] = [];

function createDependencies(overrides: { declarationLoadTimeoutMs?: number } = {}) {
  return {
    store,
    source,
    writer: new EnvironmentSettingsWriter({ source, store }),
    adoption: {
      suppressPromptFor: (scope: EnvironmentScope, id: string) => {
        events.push(`suppress ${scope} ${id}`);
        return { dispose: () => events.push(`dispose ${scope} ${id}`) };
      },
      adoptWithoutPrompt: async (
        scope: EnvironmentScope,
        id: string,
        stored?: { scope: EnvironmentScope; id: string }
      ) => {
        adoptCalls.push([scope, id, stored]);
        events.push(`adopt ${scope} ${id}`);
        return adoptResult;
      }
    },
    refreshHost: {
      fullEnvironmentRefresh: (request?: unknown) => {
        refreshes.push(request);
        return { executed: true } as never;
      }
    },
    log: { appendLine: (line: string) => logLines.push(line), show: () => undefined },
    declarationLoadTimeoutMs: overrides.declarationLoadTimeoutMs ?? 200
  };
}

const pickAll = (items: Array<Record<string, unknown>>) => items;
const pickLabel = (label: string) => (items: Array<Record<string, unknown>>) =>
  items.find((item) => item.label === label);

beforeEach(() => {
  ui.quickPicks = [];
  ui.pick = [];
  ui.inputBoxes = [];
  ui.input = undefined;
  ui.saveDialogs = [];
  ui.saveUri = undefined;
  ui.openUri = undefined;
  ui.messages = [];
  ui.respond = undefined;
  ui.executed = [];
  ui.written.clear();
  ui.files.clear();
  events.length = 0;
  settings.globalValue = undefined;
  settings.workspaceValue = undefined;
  settings.loadedGlobal = undefined;
  settings.loadedWorkspace = undefined;
  settings.autoLoad = true;
  workspace.isTrusted = true;
  workspace.workspaceFolders = [{ uri: vscodeStub.Uri.file("/repo"), name: "repo", index: 0 }];
  workspace.workspaceFile = undefined;
  extraDeclared.length = 0;
  tls.response = false;
  tls.calls = [];
  store = new FakeStore();
  adoptResult = { status: "adopted", warnings: [] };
  adoptCalls = [];
  refreshes.length = 0;
  logLines.length = 0;
});

const UUIDS = [
  "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
  "6fa459ea-ee8a-3ca4-894e-db77e160355e",
  "886313e1-3b8a-5372-9b90-0c9aee199e5d",
  "a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d",
  "c56a4180-65aa-42ec-a945-5fd21dec0538",
  "0f8fad5b-d9cb-469f-a165-70867728950e"
];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("slugs", () => {
  it("derives a slug from the name, else the host", () => {
    expect(toSlugCandidate({ name: "  CI Server (Prod)! ", url: "https://x.example/" })).toBe(
      "ci-server-prod"
    );
    expect(toSlugCandidate({ url: "https://Build.Example.org:8443/jenkins/" })).toBe(
      "build.example.org"
    );
    expect(toSlugCandidate({ name: "--__", url: "not a url" })).toBe("jenkins");
    expect(toSlugCandidate({ name: "a".repeat(80), url: "https://x.example/" })).toHaveLength(64);
  });

  it("dedupes with numeric suffixes within 64 characters", () => {
    expect(dedupeSlug("ci", new Set())).toBe("ci");
    expect(dedupeSlug("ci", new Set(["ci", "ci-2"]))).toBe("ci-3");
    const long = "a".repeat(64);
    expect(dedupeSlug(long, new Set([long]))).toBe(`${"a".repeat(62)}-2`);
  });

  it("validates share slugs against the pattern and taken ids", () => {
    const taken = new Set(["ci"]);
    expect(validateSlug("ci", taken, "user")).toMatch(/already declared in user settings/);
    expect(validateSlug("-bad", taken, "user")).toMatch(/letters, digits/);
    expect(validateSlug("has space", taken, "user")).toMatch(/letters, digits/);
    expect(validateSlug("ci-2", taken, "workspace")).toBeUndefined();
  });
});

describe("resolveShareableAuthHint", () => {
  const manual = { id: "uuid-1", url: "https://ci.example/", scope: "global" as const };
  const withAuth = (authConfig: JenkinsAuthConfig | undefined) => ({
    getAuthConfig: async () => authConfig
  });

  it("maps auth configs like the store: SSO credentials stripped, invalid URLs dropped", async () => {
    expect(
      await resolveShareableAuthHint(
        withAuth({ type: "sso", loginUrl: "https://user:pw@sso.example/login", headers: {} }),
        manual
      )
    ).toEqual({ type: "sso", loginUrl: "https://sso.example/login" });
    expect(
      await resolveShareableAuthHint(
        withAuth({ type: "sso", loginUrl: "not a url", headers: {} }),
        manual
      )
    ).toBeUndefined();
    expect(
      await resolveShareableAuthHint(withAuth({ type: "cookie", cookie: "a=b" }), manual)
    ).toBeUndefined();
    expect(
      await resolveShareableAuthHint(withAuth(undefined), {
        ...manual,
        authHint: { type: "bearer" }
      })
    ).toEqual({ type: "bearer" });
  });
});

describe("exportEnvironments", () => {
  function seedEnvironments() {
    store.stored.global = [
      {
        id: UUIDS[0],
        url: "https://alice:pw-SECRET@ci.example.com/jenkins",
        name: "CI Server",
        username: "legacy-user-SECRET",
        previousUrls: ["https://old-host.example.com/"]
      },
      { id: UUIDS[1], url: "https://ci2.example.com/", name: "CI Server" },
      { id: UUIDS[2], url: "https://Build.Example.org:8443/" },
      { id: UUIDS[3], url: "https://hdr.example.com/", name: "Héllo  World!!" },
      { id: UUIDS[4], url: "https://sso.example.com/", allowInsecureTls: true }
    ];
    store.stored.workspace = [
      { id: UUIDS[5], url: "http://plain.example.com/", authHint: { type: "none" } }
    ];
    store.authConfigs.set(`global:${UUIDS[0]}`, {
      type: "basic",
      username: "basic-user-SECRET",
      token: "basic-token-SECRET"
    });
    store.authConfigs.set(`global:${UUIDS[1]}`, { type: "bearer", token: "bearer-SECRET" });
    store.authConfigs.set(`global:${UUIDS[2]}`, {
      type: "cookie",
      cookie: "JSESSION=cookie-SECRET"
    });
    store.authConfigs.set(`global:${UUIDS[3]}`, {
      type: "headers",
      headers: { "X-Forwarded-User": "header-SECRET" }
    });
    store.authConfigs.set(`global:${UUIDS[4]}`, {
      type: "sso",
      loginUrl: "https://login.example.com/start",
      headers: { Cookie: "sso-cookie-SECRET" },
      expiresAt: 123
    });
    // A shared environment keeps its slug; manual ones are numbered around it.
    settings.loadedWorkspace = [
      { id: "ci-server", url: "https://shared.example.com/", auth: { type: "bearer" } }
    ];
  }

  it("writes only non-secret fields with deduped slugs and auth hints", async () => {
    seedEnvironments();
    ui.pick.push(pickAll);
    ui.saveUri = vscodeStub.Uri.file("/out/team.jenkins-environments.json");

    const uri = await exportEnvironments(createDependencies());

    expect(uri?.path).toBe("/out/team.jenkins-environments.json");
    expect(ui.quickPicks[0]?.items.every((item) => item.picked === true)).toBe(true);
    expect(ui.saveDialogs[0]?.defaultUri?.path).toBe(`/repo/${EXPORT_FILE_NAME}`);
    const text = ui.written.get("/out/team.jenkins-environments.json") ?? "";
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({
      version: 1,
      environments: [
        { id: "plain.example.com", url: "http://plain.example.com/", auth: { type: "none" } },
        {
          id: "ci-server",
          url: "https://shared.example.com/",
          auth: { type: "bearer" }
        },
        {
          id: "ci-server-2",
          url: "https://ci.example.com/jenkins/",
          name: "CI Server",
          auth: { type: "basic" }
        },
        {
          id: "ci-server-3",
          url: "https://ci2.example.com/",
          name: "CI Server",
          auth: { type: "bearer" }
        },
        { id: "build.example.org", url: "https://build.example.org:8443/" },
        { id: "h-llo-world", url: "https://hdr.example.com/", name: "Héllo  World!!" },
        {
          id: "sso.example.com",
          url: "https://sso.example.com/",
          allowInsecureTls: true,
          auth: { type: "sso", loginUrl: "https://login.example.com/start" }
        }
      ]
    });

    for (const secret of [
      "SECRET",
      "pw-",
      "alice",
      "legacy-user",
      "old-host",
      "previousUrls",
      "username",
      "token",
      "cookie",
      "headers",
      "expiresAt",
      ...UUIDS
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(UUID_PATTERN);
    expect(ui.messages.at(-1)).toMatchObject({
      kind: "info",
      message: expect.stringMatching(
        /^Exported 7 Jenkins environments to team\.jenkins-environments\.json/
      ),
      items: ["Reveal"]
    });
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    seedEnvironments();
    ui.pick.push(pickAll);

    expect(await exportEnvironments(createDependencies())).toBeUndefined();
    expect(ui.written.size).toBe(0);
  });

  it("exports only the selected environments", async () => {
    seedEnvironments();
    ui.pick.push((items) => items.filter((item) => item.label === "CI Server").slice(0, 1));
    ui.saveUri = vscodeStub.Uri.file("/out/one.json");

    await exportEnvironments(createDependencies());

    // Slugs only need to be unique within the file.
    expect(JSON.parse(ui.written.get("/out/one.json") ?? "{}").environments).toEqual([
      {
        id: "ci-server",
        url: "https://ci.example.com/jenkins/",
        name: "CI Server",
        auth: { type: "basic" }
      }
    ]);
  });
});

describe("importEnvironments", () => {
  const FILE = vscodeStub.Uri.file("/in/team.jenkins-environments.json");

  function seedFile(environments: unknown[], version: unknown = 1) {
    ui.files.set(FILE.path, JSON.stringify({ version, environments }));
    ui.openUri = FILE;
  }

  const IMPORTED = [
    { id: "ci", url: "https://ci.example/", name: "CI", auth: { type: "basic" } },
    { id: "open", url: "https://open.example/", auth: { type: "none" } },
    { id: "lab", url: "https://lab.example/", allowInsecureTls: true },
    { id: "existing", url: "https://EXISTING.example" },
    { id: "bad", url: "ftp://nope.example/" }
  ];

  it("writes to user settings, skips existing URLs and invalid entries, and offers sign-in", async () => {
    store.stored.workspace = [{ id: UUIDS[0], url: "https://existing.example/", name: "Old" }];
    seedFile(IMPORTED);
    ui.pick.push(pickLabel("User settings"));
    ui.respond = (call) => (call.items.includes("Sign In Now") ? "Sign In Now" : undefined);
    tls.response = true;

    const result = await importEnvironments(createDependencies());

    expect(result?.destination).toBe("user");
    expect(settings.globalValue).toEqual([
      { id: "ci", url: "https://ci.example/", name: "CI", auth: { type: "basic" } },
      { id: "open", url: "https://open.example/", auth: { type: "none" } },
      { id: "lab", url: "https://lab.example/", allowInsecureTls: true }
    ]);
    expect(tls.calls).toEqual([
      { placeHolder: "TLS certificate validation for lab (the file turns verification off)" }
    ]);
    expect(settings.workspaceValue).toBeUndefined();
    expect(result?.skipped).toEqual([
      {
        label: "existing",
        reason: "https://existing.example/ already has an environment (Old)"
      }
    ]);
    expect(result?.problems).toHaveLength(1);
    expect(refreshes).toHaveLength(1);

    const summary = ui.messages.find((call) => call.message.startsWith("Imported"));
    expect(summary).toMatchObject({ kind: "info", items: ["Sign In Now", "Show Details"] });
    expect(summary?.message).toContain("Imported 3 environments to user settings.");
    expect(summary?.message).toContain("Skipped 1.");
    expect(summary?.message).toContain("1 problem in the file.");
    expect(logLines.join("\n")).toContain("already has an environment (Old)");
    expect(logLines.join("\n")).toContain('"url" must be an http(s) Jenkins URL');

    expect(
      ui.executed.map(([command, ref]) => [
        command,
        (ref as { environmentId: string }).environmentId
      ])
    ).toEqual([
      ["jenkinsWorkbench.signInToEnvironment", "settings:ci"],
      ["jenkinsWorkbench.signInToEnvironment", "settings:open"],
      ["jenkinsWorkbench.signInToEnvironment", "settings:lab"]
    ]);
  });

  it("keeps verification on in user settings unless the TLS prompt is confirmed", async () => {
    seedFile([IMPORTED[2]]);
    ui.pick.push(pickLabel("User settings"));
    tls.response = undefined;

    await importEnvironments(createDependencies());

    expect(settings.globalValue).toEqual([{ id: "lab", url: "https://lab.example/" }]);
    expect(tls.calls).toHaveLength(1);
  });

  it("writes to workspace settings without allowInsecureTls and skips taken ids", async () => {
    settings.workspaceValue = [{ id: "ci", url: "https://elsewhere.example/" }];
    settings.loadedWorkspace = settings.workspaceValue;
    seedFile(IMPORTED.slice(0, 3));
    ui.pick.push(pickLabel("Workspace settings"));

    const result = await importEnvironments(createDependencies());

    expect(settings.workspaceValue).toEqual([
      { id: "ci", url: "https://elsewhere.example/" },
      { id: "open", url: "https://open.example/", auth: { type: "none" } },
      { id: "lab", url: "https://lab.example/" }
    ]);
    expect(result?.added.map((entry) => [entry.scope, entry.id])).toEqual([
      ["workspace", "settings:open"],
      ["workspace", "settings:lab"]
    ]);
    const summary = ui.messages.at(-1);
    expect(summary?.message).toContain("Imported 2 environments to workspace settings.");
    expect(summary?.message).toContain('Skipped 1: CI ("ci" is already in workspace settings).');
    expect(summary?.message).toContain('"allowInsecureTls" was left out for "lab"');
    expect(summary?.items).toEqual(["Sign In Now"]);
    expect(ui.executed).toEqual([]);
  });

  it("offers workspace settings only when a trusted workspace is open", async () => {
    seedFile(IMPORTED.slice(0, 1));
    workspace.workspaceFolders = undefined;
    await importEnvironments(createDependencies());
    expect(ui.quickPicks[0]?.items.map((item) => item.label)).toEqual([
      "User settings",
      "Local only"
    ]);

    workspace.workspaceFolders = [{ uri: vscodeStub.Uri.file("/repo"), name: "repo", index: 0 }];
    workspace.isTrusted = false;
    await importEnvironments(createDependencies());
    expect(ui.quickPicks[1]?.items.map((item) => item.label)).toEqual([
      "User settings",
      "Local only"
    ]);

    workspace.isTrusted = true;
    workspace.workspaceFile = vscodeStub.Uri.file("/repo/team.code-workspace");
    await importEnvironments(createDependencies());
    expect(ui.quickPicks[2]?.items[0]).toMatchObject({
      label: "Workspace settings",
      detail: "Saved in the team.code-workspace workspace file"
    });
  });

  it("imports locally with new ids, auth hints, and confirmed insecure TLS", async () => {
    store.stored.workspace = [{ id: UUIDS[0], url: "https://existing.example/" }];
    extraDeclared.push({
      scope: "global",
      slug: "declared",
      id: "settings:declared",
      url: "https://declared.example/",
      origin: { level: "user" }
    });
    seedFile([
      ...IMPORTED,
      { id: "dup-declared", url: "https://declared.example" },
      { id: "plain", url: "http://plain.example/", allowInsecureTls: true }
    ]);
    ui.pick.push(pickLabel("Local only"));
    tls.response = true;

    const result = await importEnvironments(createDependencies());

    expect(store.added.map(({ scope }) => scope)).toEqual(["global", "global", "global", "global"]);
    for (const { environment } of store.added) {
      expect(environment.id).toMatch(UUID_PATTERN);
      expect(environment.id).not.toMatch(/^settings:/);
    }
    expect(store.added.map(({ environment: { id: _id, ...rest } }) => rest)).toEqual([
      { url: "https://ci.example/", name: "CI", authHint: { type: "basic" } },
      { url: "https://open.example/", authHint: { type: "none" } },
      { url: "https://lab.example/", allowInsecureTls: true },
      // TLS verification only applies to https.
      { url: "http://plain.example/" }
    ]);
    expect(tls.calls).toEqual([
      { placeHolder: "TLS certificate validation for lab (the file turns verification off)" }
    ]);
    expect(result?.skipped.map((entry) => entry.label)).toEqual(["existing", "dup-declared"]);

    const summary = ui.messages.at(-1);
    expect(summary?.message).toContain("Imported 4 environments to this machine.");
    // Only the basic-auth environment needs credentials.
    expect(summary?.items).toContain("Sign In Now");
  });

  it("keeps verification on when the local TLS prompt is declined or dismissed", async () => {
    seedFile([IMPORTED[2]]);
    ui.pick.push(pickLabel("Local only"));
    tls.response = undefined;

    await importEnvironments(createDependencies());

    expect(store.added[0]?.environment).not.toHaveProperty("allowInsecureTls");
    expect(ui.messages.at(-1)?.items).toEqual([]);
  });

  it("aborts without a destination prompt when nothing in the file is valid", async () => {
    seedFile([{ id: "bad", url: "ftp://nope.example/" }]);

    expect(await importEnvironments(createDependencies())).toBeUndefined();
    expect(ui.quickPicks).toEqual([]);
    expect(ui.messages).toEqual([
      expect.objectContaining({
        kind: "error",
        message: expect.stringContaining("No environments could be imported")
      })
    ]);
  });

  it("rejects unsupported versions and unreadable files", async () => {
    seedFile(IMPORTED, 2);
    await importEnvironments(createDependencies());
    expect(ui.messages.at(-1)?.message).toContain("Unsupported export file version 2");

    ui.files.set(FILE.path, "{ not json");
    await importEnvironments(createDependencies());
    expect(ui.messages.at(-1)?.message).toMatch(/^Could not read team\.jenkins-environments\.json/);
    expect(ui.quickPicks).toEqual([]);
  });

  it("reports when every entry is skipped", async () => {
    store.stored.global = [{ id: UUIDS[1], url: "https://ci.example/" }];
    seedFile([IMPORTED[0]]);
    ui.pick.push(pickLabel("User settings"));

    const result = await importEnvironments(createDependencies());

    expect(result?.added).toEqual([]);
    expect(settings.globalValue).toBeUndefined();
    expect(ui.messages.at(-1)).toMatchObject({
      kind: "warning",
      message:
        "No environments were imported to user settings. Skipped 1: CI (https://ci.example/ already has an environment (https://ci.example/))."
    });
  });
});

describe("shareEnvironmentInSettings", () => {
  const MANUAL = {
    environmentId: UUIDS[0],
    scope: "workspace" as const,
    url: "https://ci.example/",
    name: "CI Server"
  };

  beforeEach(() => {
    store.stored.workspace = [
      { id: UUIDS[0], url: "https://ci.example/", name: "CI Server", allowInsecureTls: true }
    ];
    store.authConfigs.set(`workspace:${UUIDS[0]}`, {
      type: "basic",
      username: "user-SECRET",
      token: "token-SECRET"
    });
  });

  it("suppresses the prompt, writes, waits for the source, then adopts", async () => {
    ui.pick.push(pickLabel("User settings"));

    const result = await shareEnvironmentInSettings(createDependencies(), MANUAL);

    expect(result).toEqual({ status: "adopted", warnings: [] });
    expect(events).toEqual([
      "suppress global settings:ci-server",
      "write user",
      "adopt global settings:ci-server",
      "dispose global settings:ci-server"
    ]);
    expect(adoptCalls).toEqual([
      ["global", "settings:ci-server", { scope: "workspace", id: UUIDS[0] }]
    ]);
    // User settings may keep the insecure-TLS opt-in.
    expect(settings.globalValue).toEqual([
      {
        id: "ci-server",
        url: "https://ci.example/",
        name: "CI Server",
        allowInsecureTls: true,
        auth: { type: "basic" }
      }
    ]);
    expect(JSON.stringify(settings.globalValue)).not.toContain("SECRET");
    expect(ui.messages.at(-1)).toMatchObject({
      kind: "info",
      message: 'Shared CI Server in user settings as "ci-server".'
    });
  });

  it("drops allowInsecureTls for workspace settings after a modal warning", async () => {
    ui.pick.push(pickLabel("Workspace settings"));
    ui.respond = (call) => (call.modal ? "Share Anyway" : undefined);

    await shareEnvironmentInSettings(createDependencies(), MANUAL);

    expect(ui.messages[0]).toMatchObject({ kind: "warning", modal: true });
    expect(settings.workspaceValue).toEqual([
      { id: "ci-server", url: "https://ci.example/", name: "CI Server", auth: { type: "basic" } }
    ]);
    expect(adoptCalls[0]?.slice(0, 2)).toEqual(["workspace", "settings:ci-server"]);
  });

  it("writes nothing when the workspace TLS warning is dismissed", async () => {
    ui.pick.push(pickLabel("Workspace settings"));

    expect(await shareEnvironmentInSettings(createDependencies(), MANUAL)).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("prefills a free slug and validates the input", async () => {
    settings.globalValue = [{ id: "ci-server", url: "https://other.example/" }];
    ui.pick.push(pickLabel("User settings"));
    ui.input = () => "custom.id";

    await shareEnvironmentInSettings(createDependencies(), MANUAL);

    const input = ui.inputBoxes[0];
    expect(input?.value).toBe("ci-server-2");
    expect(input?.validateInput?.("ci-server")).toMatch(/already declared/);
    expect(input?.validateInput?.("bad slug")).toMatch(/letters, digits/);
    expect(input?.validateInput?.("custom.id")).toBeUndefined();
    expect(adoptCalls[0]?.[1]).toBe("settings:custom.id");
  });

  it("disposes the suppression when writing fails", async () => {
    ui.pick.push(pickLabel("User settings"));
    settings.globalValue = "not a list";

    const result = await shareEnvironmentInSettings(createDependencies(), MANUAL);

    expect(result).toBeUndefined();
    expect(events).toEqual([
      "suppress global settings:ci-server",
      "dispose global settings:ci-server"
    ]);
    expect(ui.messages.at(-1)).toMatchObject({
      kind: "error",
      message: expect.stringContaining("Could not share CI Server")
    });
  });

  it("does not adopt when the declaration is skipped or never loads", async () => {
    extraDeclared.push({
      scope: "global",
      slug: "shared",
      id: "settings:shared",
      url: "https://ci.example/",
      origin: { level: "user" }
    });
    ui.pick.push(pickLabel("User settings"));
    await shareEnvironmentInSettings(createDependencies(), MANUAL);
    expect(ui.messages.at(-1)?.message).toContain('already shared as "shared"');
    expect(adoptCalls).toEqual([]);
    expect(events.at(-1)).toBe("dispose global settings:ci-server");

    extraDeclared.length = 0;
    events.length = 0;
    settings.autoLoad = false;
    ui.pick.push(pickLabel("User settings"));
    const result = await shareEnvironmentInSettings(
      createDependencies({ declarationLoadTimeoutMs: 20 }),
      MANUAL
    );
    expect(result).toBeUndefined();
    expect(adoptCalls).toEqual([]);
    expect(events).toEqual([
      "suppress global settings:ci-server",
      "write user",
      "dispose global settings:ci-server"
    ]);
    expect(ui.messages.at(-1)?.message).toContain("has not loaded yet");
  });

  it("returns adoption failures without its own success message", async () => {
    adoptResult = { status: "failed", failures: [new Error("copy failed")], rollbackFailures: [] };
    ui.pick.push(pickLabel("User settings"));

    const result = await shareEnvironmentInSettings(createDependencies(), MANUAL);

    expect(result?.status).toBe("failed");
    expect(ui.messages.filter((call) => call.kind === "info")).toEqual([]);
    expect(events.at(-1)).toBe("dispose global settings:ci-server");
  });

  it("refuses shared environments and lists only manual ones in the palette", async () => {
    settings.loadedGlobal = [{ id: "team", url: "https://team.example/" }];
    await shareEnvironmentInSettings(createDependencies(), {
      environmentId: "settings:team",
      scope: "global",
      url: "https://team.example/"
    });
    expect(ui.messages.at(-1)?.message).toContain("already shared through settings");

    await shareEnvironmentInSettings(createDependencies());
    expect(ui.quickPicks.at(-1)?.items.map((item) => item.label)).toEqual(["CI Server"]);
  });
});
