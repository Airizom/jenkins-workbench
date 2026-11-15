/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${workspaceFolder}` setting fixtures. */
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, it, vi } from "vitest";
import type * as vscode from "vscode";
import * as vscodeStub from "./helpers/vscodeStub";

const { Uri, FileType } = vscodeStub;
type StubUri = vscodeStub.Uri;
const fileUri = (fsPath: string) => Uri.file(fsPath) as unknown as vscode.Uri;

const files = new Map<string, string>();
const directories = new Set<string>();
const calls = { readDirectory: 0, readFile: 0, stat: 0, watchers: 0 };
let gate: Promise<void> | undefined;

type WatchHandler = (uri: StubUri) => void;

interface FakeWatcher {
  pattern: string | InstanceType<typeof vscodeStub.RelativePattern>;
  ignored: [boolean, boolean, boolean];
  handlers: { create: WatchHandler[]; change: WatchHandler[]; delete: WatchHandler[] };
  disposed: boolean;
}
const watchers: FakeWatcher[] = [];

const workspace = {
  workspaceFolders: undefined as Array<{ uri: StubUri; name: string; index: number }> | undefined,
  fs: {
    async readDirectory(uri: StubUri): Promise<[string, number][]> {
      calls.readDirectory += 1;
      if (gate) {
        await gate;
      }
      if (!directories.has(uri.path)) {
        throw new Error(`ENOENT ${uri.path}`);
      }
      const entries: [string, number][] = [];
      for (const filePath of files.keys()) {
        const slash = filePath.lastIndexOf("/");
        if (filePath.slice(0, slash) === uri.path) {
          entries.push([filePath.slice(slash + 1), FileType.File]);
        }
      }
      for (const directory of directories) {
        const slash = directory.lastIndexOf("/");
        if (directory.slice(0, slash) === uri.path) {
          entries.push([directory.slice(slash + 1), FileType.Directory]);
        }
      }
      return entries;
    },
    async readFile(uri: StubUri): Promise<Uint8Array> {
      calls.readFile += 1;
      const content = files.get(uri.path);
      if (content === undefined) {
        throw new Error(`ENOENT ${uri.path}`);
      }
      return new TextEncoder().encode(content);
    },
    async stat(uri: StubUri): Promise<{ type: number }> {
      calls.stat += 1;
      if (directories.has(uri.path)) {
        return { type: FileType.Directory };
      }
      throw new Error(`ENOENT ${uri.path}`);
    }
  },
  createFileSystemWatcher(
    pattern: FakeWatcher["pattern"],
    ignoreCreate = false,
    ignoreChange = false,
    ignoreDelete = false
  ) {
    calls.watchers += 1;
    const watcher: FakeWatcher = {
      pattern,
      ignored: [ignoreCreate, ignoreChange, ignoreDelete],
      handlers: { create: [], change: [], delete: [] },
      disposed: false
    };
    watchers.push(watcher);
    const subscribe = (kind: keyof FakeWatcher["handlers"]) => (handler: WatchHandler) => {
      watcher.handlers[kind].push(handler);
      return {
        dispose: () => {
          watcher.handlers[kind] = watcher.handlers[kind].filter((entry) => entry !== handler);
        }
      };
    };
    return {
      onDidCreate: subscribe("create"),
      onDidChange: subscribe("change"),
      onDidDelete: subscribe("delete"),
      dispose: () => {
        watcher.disposed = true;
      }
    };
  }
};

vi.doMock("vscode", () => ({ ...vscodeStub, workspace }));

const { JenkinsSharedLibraryIndex } = await import(
  "../src/jenkinsfile/sharedLibraries/JenkinsSharedLibraryIndex"
);
type ConfigEntry =
  import("../src/jenkinsfile/sharedLibraries/JenkinsSharedLibraryTypes").JenkinsSharedLibraryConfigEntry;

function addFile(filePath: string, content: string): void {
  files.set(filePath, content);
  const parts = filePath.split("/");
  for (let index = 2; index < parts.length; index += 1) {
    directories.add(parts.slice(0, index).join("/"));
  }
}

function setWorkspaceFolders(...paths: string[]): void {
  workspace.workspaceFolders = paths.map((folderPath, index) => ({
    uri: Uri.file(folderPath),
    name: `folder-${index}`,
    index
  }));
}

function createIndex(entries: ConfigEntry[] = []) {
  return new JenkinsSharedLibraryIndex(() => entries);
}

const WORKSPACE_WATCHERS = [
  ["**/vars/*.{groovy,txt}", false],
  ["**/vars", false],
  ["**/*", false]
];

function describeWatchers() {
  return watchers.map((watcher) => {
    const pattern =
      typeof watcher.pattern === "string"
        ? watcher.pattern
        : `${watcher.pattern.base.path} ${watcher.pattern.pattern}`;
    return [pattern, watcher.disposed];
  });
}

function fire(watcher: FakeWatcher, kind: keyof FakeWatcher["handlers"], fsPath = "/unused"): void {
  for (const handler of watcher.handlers[kind]) {
    handler(Uri.file(fsPath));
  }
}

beforeEach(() => {
  files.clear();
  directories.clear();
  watchers.length = 0;
  gate = undefined;
  calls.readDirectory = 0;
  calls.readFile = 0;
  calls.stat = 0;
  calls.watchers = 0;
  workspace.workspaceFolders = undefined;
});

describe("JenkinsSharedLibraryIndex", () => {
  it("does no file system work or watching until first use", () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex([{ name: "external", path: "/libs/external" }]);

    assert.equal(index.isVarsFile(fileUri("/ws/acme/vars/deploy.groovy")), true);
    assert.equal(index.isVarsFile(fileUri("/libs/external/vars/tool.groovy")), true);
    assert.deepEqual(calls, { readDirectory: 0, readFile: 0, stat: 0, watchers: 0 });
    index.dispose();
  });

  it("discovers workspace folders with a top-level vars directory", async () => {
    setWorkspaceFolders("/ws/acme", "/ws/app");
    addFile("/ws/acme/vars/deploy.groovy", "def call(String env) {}");
    addFile("/ws/acme/vars/deploy.txt", "<p>Deploys</p>");
    addFile("/ws/acme/vars/notes.md", "ignored");
    addFile("/ws/acme/vars/bad-name.groovy", "def call() {}");
    addFile("/ws/app/Jenkinsfile", "pipeline {}");
    const index = createIndex();

    const libraries = await index.getLibraries();
    assert.deepEqual(libraries, [
      {
        name: "acme",
        rootUri: "file:///ws/acme",
        implicit: false,
        configured: false,
        varNames: ["deploy"]
      }
    ]);
    const deploy = await index.getVar("acme", "deploy");
    assert.equal(deploy?.documentation, "Deploys");
    assert.equal(deploy?.source?.uri, "file:///ws/acme/vars/deploy.groovy");
    assert.equal(deploy?.signatures[0].label, "deploy(env: String)");
    assert.equal(await index.getVar("acme", "missing"), undefined);
    assert.equal(await index.getVars("unknown"), undefined);
    assert.deepEqual(describeWatchers(), WORKSPACE_WATCHERS);
    // Folder watchers skip changes; the catch-all watcher only reports deletes.
    assert.deepEqual(
      watchers.map((watcher) => watcher.ignored),
      [
        [false, false, false],
        [false, true, false],
        [true, true, false]
      ]
    );
    index.dispose();
  });

  it("resolves configured absolute, relative, and ${workspaceFolder} paths", async () => {
    setWorkspaceFolders("/ws/main", "/ws/second");
    addFile("/abs/lib/vars/absVar.groovy", "def call() {}");
    addFile("/ws/main/libs/rel/vars/relVar.groovy", "def call() {}");
    addFile("/ws/main/shared/vars/wsVar.groovy", "def call() {}");
    const index = createIndex([
      { name: "abs", path: "/abs/lib", implicit: true },
      { name: "rel", path: "libs/rel" },
      { name: "ws", path: "${workspaceFolder}/shared/" },
      { name: "", path: "/abs/lib" },
      { name: "nowhere", path: "/does/not/exist" }
    ]);

    const libraries = await index.getLibraries();
    assert.deepEqual(
      libraries.map((library) => [
        library.name,
        library.rootUri,
        library.implicit,
        library.configured
      ]),
      [
        ["abs", "file:///abs/lib", true, true],
        ["rel", "file:///ws/main/libs/rel", false, true],
        ["ws", "file:///ws/main/shared", false, true]
      ]
    );
    index.dispose();
  });

  it("resolves ${workspaceFolder:<name>} by folder name and ~/ against the home directory", async () => {
    workspace.workspaceFolders = [
      { uri: Uri.file("/ws/main"), name: "main", index: 0 },
      { uri: Uri.file("/ws/tools"), name: "tools", index: 1 }
    ];
    const home = os.homedir();
    addFile("/ws/tools/shared/vars/toolVar.groovy", "def call() {}");
    addFile("/ws/tools/vars/rootVar.groovy", "def call() {}");
    addFile(path.join(home, "libs/home/vars/homeVar.groovy"), "def call() {}");
    const index = createIndex([
      { name: "named", path: "${workspaceFolder:tools}/shared" },
      { name: "namedRoot", path: "${workspaceFolder:tools}" },
      { name: "unknownFolder", path: "${workspaceFolder:nope}/shared" },
      { name: "home", path: "~/libs/home" }
    ]);

    assert.equal(index.isVarsFile(fileUri("/ws/tools/shared/vars/toolVar.groovy")), true);
    assert.deepEqual(
      (await index.getLibraries()).map((library) => [library.name, library.rootUri]),
      [
        ["named", "file:///ws/tools/shared"],
        ["namedRoot", "file:///ws/tools"],
        ["home", Uri.file(path.join(home, "libs/home")).toString()]
      ]
    );
    index.dispose();
  });

  it("keeps the first workspace folder with a basename once loaded", async () => {
    setWorkspaceFolders("/one/lib", "/two/lib");
    addFile("/one/lib/vars/first.groovy", "def call() {}");
    addFile("/two/lib/vars/second.groovy", "def call() {}");
    const index = createIndex();
    const first = fileUri("/one/lib/vars/first.groovy");
    const second = fileUri("/two/lib/vars/second.groovy");

    // Before loading, either folder could win `lib` (the first might lack `vars/`).
    assert.equal(index.isVarsFile(first), true);
    assert.equal(index.isVarsFile(second), true);
    assert.deepEqual(
      (await index.getLibraries()).map((library) => library.rootUri),
      ["file:///one/lib"]
    );
    assert.equal(index.isVarsFile(first), true);
    assert.equal(index.isVarsFile(second), false);
    index.dispose();
  });

  it("lets a workspace folder serve vars files when a same-named configured path is missing", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex([{ name: "acme", path: "/libs/acme" }]);
    const varsFile = fileUri("/ws/acme/vars/deploy.groovy");

    assert.equal(index.isVarsFile(varsFile), true);
    assert.deepEqual(
      (await index.getLibraries()).map((library) => [library.name, library.rootUri]),
      [["acme", "file:///ws/acme"]]
    );
    assert.equal(index.isVarsFile(varsFile), true);
    assert.equal(index.isVarsFile(fileUri("/libs/acme/vars/deploy.groovy")), false);
    index.dispose();
  });

  it("starts exactly one background load from the first pre-load isVarsFile answer", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex([{ name: "external", path: "/libs/external" }]);
    const varsFile = fileUri("/ws/acme/vars/deploy.groovy");
    const idle = { readDirectory: 0, readFile: 0, stat: 0, watchers: 0 };
    assert.deepEqual(calls, idle);

    // Paths that are not vars files never start a load.
    assert.equal(index.isVarsFile(fileUri("/ws/acme/Jenkinsfile")), false);
    await Promise.resolve();
    assert.deepEqual(calls, idle);

    // The answer itself is synchronous and I/O-free; the load follows it.
    assert.equal(index.isVarsFile(varsFile), true);
    assert.equal(index.isVarsFile(varsFile), true);
    assert.deepEqual(calls, idle);
    await Promise.resolve();
    // One load: both candidate roots read, workspace watchers created once.
    assert.equal(calls.readDirectory, 2);
    assert.equal(calls.watchers, 3);

    assert.deepEqual(
      (await index.getLibraries()).map((library) => library.name),
      ["acme"]
    );
    // The completed load also watches the missing outside root's parent; nothing more follows.
    const loaded = { ...calls };
    assert.equal(loaded.readDirectory, 2);
    assert.equal(index.isVarsFile(varsFile), true);
    await Promise.resolve();
    assert.deepEqual(calls, loaded);
    index.dispose();
  });

  it("lets a configured entry win over the discovered folder at the same path", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex([
      { name: "pipeline-lib", path: "${workspaceFolder}", implicit: true }
    ]);

    const libraries = await index.getLibraries();
    assert.deepEqual(
      libraries.map((library) => [library.name, library.configured, library.implicit]),
      [["pipeline-lib", true, true]]
    );
    const found = await index.findLibraryForVarsFile(fileUri("/ws/acme/vars/deploy.groovy"));
    assert.equal(found?.name, "pipeline-lib");
    index.dispose();
  });

  it("keeps configured libraries without vars but skips missing roots", async () => {
    directories.add("/libs");
    directories.add("/libs/src-only");
    const index = createIndex([
      { name: "srcOnly", path: "/libs/src-only" },
      { name: "missing", path: "/libs/missing" }
    ]);

    const libraries = await index.getLibraries();
    assert.deepEqual(
      libraries.map((library) => [library.name, library.varNames]),
      [["srcOnly", []]]
    );
    index.dispose();
  });

  it("skips relative and ${workspaceFolder} paths without a workspace folder", async () => {
    addFile("/abs/vars/one.groovy", "def call() {}");
    const index = createIndex([
      { name: "rel", path: "libs/rel" },
      { name: "ws", path: "${workspaceFolder}/x" },
      { name: "abs", path: "/abs" }
    ]);

    assert.deepEqual(
      (await index.getLibraries()).map((library) => library.name),
      ["abs"]
    );
    index.dispose();
  });

  it("shares one in-flight load and caches the result", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex();

    const [first, second] = await Promise.all([index.getLibraries(), index.getVars("acme")]);
    assert.equal(first.length, 1);
    assert.equal(second?.size, 1);
    await index.getLibraries();
    assert.equal(calls.readDirectory, 1);
    assert.equal(calls.watchers, 3);
    index.dispose();
  });

  it("reloads after watcher events and invalidate()", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex();

    assert.deepEqual((await index.getLibraries())[0].varNames, ["deploy"]);
    addFile("/ws/acme/vars/notify.groovy", "def call() {}");
    fire(watchers[0], "create", "/ws/acme/vars/notify.groovy");
    assert.deepEqual((await index.getLibraries())[0].varNames, ["deploy", "notify"]);

    files.delete("/ws/acme/vars/deploy.groovy");
    fire(watchers[0], "delete", "/ws/acme/vars/deploy.groovy");
    assert.deepEqual((await index.getLibraries())[0].varNames, ["notify"]);

    files.set("/ws/acme/vars/notify.groovy", "def call(String message) {}");
    fire(watchers[0], "change", "/ws/acme/vars/notify.groovy");
    assert.equal(
      (await index.getVar("acme", "notify"))?.signatures[0].label,
      "notify(message: String)"
    );

    addFile("/ws/acme/vars/third.groovy", "def call() {}");
    index.invalidate();
    assert.deepEqual((await index.getLibraries())[0].varNames, ["notify", "third"]);
    assert.equal(calls.readDirectory, 5);
    assert.equal(calls.watchers, 3);
    index.dispose();
  });

  it("does not cache a load that an invalidation overtook", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex();
    let release: () => void = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });

    const stale = index.getLibraries();
    await Promise.resolve();
    index.invalidate();
    addFile("/ws/acme/vars/notify.groovy", "def call() {}");
    gate = undefined;
    release();

    assert.deepEqual((await stale)[0].varNames, ["deploy", "notify"]);
    const readsBefore = calls.readDirectory;
    await index.getLibraries();
    assert.equal(calls.readDirectory, readsBefore + 1);
    await index.getLibraries();
    assert.equal(calls.readDirectory, readsBefore + 1);
    index.dispose();
  });

  it("answers isVarsFile from the loaded roots once loaded", async () => {
    setWorkspaceFolders("/ws/acme", "/ws/app");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    addFile("/ws/app/Jenkinsfile", "pipeline {}");
    const index = createIndex();

    // Before loading, any workspace folder root qualifies.
    assert.equal(index.isVarsFile(fileUri("/ws/app/vars/x.groovy")), true);
    await index.getLibraries();
    const reads = calls.readDirectory + calls.readFile + calls.stat;

    assert.equal(index.isVarsFile(fileUri("/ws/acme/vars/deploy.groovy")), true);
    assert.equal(index.isVarsFile(fileUri("/ws/app/vars/x.groovy")), false);
    assert.equal(index.isVarsFile(fileUri("/ws/acme/vars/nested/deploy.groovy")), false);
    assert.equal(index.isVarsFile(fileUri("/ws/acme/vars/deploy.txt")), false);
    assert.equal(index.isVarsFile(fileUri("/ws/acme/src/deploy.groovy")), false);
    assert.equal(index.isVarsFile(fileUri("/elsewhere/vars/deploy.groovy")), false);
    assert.equal(calls.readDirectory + calls.readFile + calls.stat, reads);

    assert.equal(
      await index.findLibraryForVarsFile(fileUri("/ws/acme/src/deploy.groovy")),
      undefined
    );
    index.dispose();
  });

  it("returns the summary for a vars file's library", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex();

    const summary = await index.findLibraryForVarsFile(fileUri("/ws/acme/vars/deploy.groovy"));
    assert.equal(summary?.name, "acme");
    const library = await index.getLibrary("acme");
    assert.equal(library?.rootUri, "file:///ws/acme");
    index.dispose();
  });

  it("disposes the watcher and its subscriptions", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = createIndex();
    await index.getLibraries();

    index.dispose();
    for (const watcher of watchers) {
      assert.equal(watcher.disposed, true);
      assert.equal(watcher.handlers.create.length, 0);
      assert.equal(watcher.handlers.change.length, 0);
      assert.equal(watcher.handlers.delete.length, 0);
    }

    // Queries after dispose still answer but do not create another watcher.
    await index.getLibraries();
    assert.equal(calls.watchers, 3);
  });

  it("treats a throwing config getter as no configured libraries", async () => {
    setWorkspaceFolders("/ws/acme");
    addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
    const index = new JenkinsSharedLibraryIndex(() => {
      throw new Error("config unavailable");
    });

    assert.deepEqual(
      (await index.getLibraries()).map((library) => library.name),
      ["acme"]
    );
    index.dispose();
  });

  describe("watchers for configured roots outside the workspace", () => {
    it("watches only loaded configured roots outside every workspace folder", async () => {
      setWorkspaceFolders("/ws/main");
      addFile("/ws/main/vars/mainVar.groovy", "def call() {}");
      addFile("/ws/main/shared/vars/inside.groovy", "def call() {}");
      addFile("/ws/mainline/vars/sibling.groovy", "def call() {}");
      addFile("/abs/lib/vars/absVar.groovy", "def call() {}");
      const index = createIndex([
        { name: "abs", path: "/abs/lib" },
        { name: "inside", path: "${workspaceFolder}/shared" },
        { name: "sibling", path: "/ws/mainline" },
        { name: "missing", path: "/does/not/exist" }
      ]);

      assert.equal(calls.watchers, 0);
      await index.getLibraries();

      assert.deepEqual(describeWatchers(), [
        ...WORKSPACE_WATCHERS,
        ["/abs/lib/vars *.{groovy,txt}", false],
        ["/abs/lib vars", false],
        ["/ws/mainline/vars *.{groovy,txt}", false],
        ["/ws/mainline vars", false],
        ["/abs lib", false],
        ["/ws mainline", false],
        ["/does/not exist", false]
      ]);
      // Outside-root patterns never contain "/", so VS Code watches each base non-recursively.
      for (const watcher of watchers.slice(WORKSPACE_WATCHERS.length)) {
        assert.equal(typeof watcher.pattern, "object");
        assert.doesNotMatch((watcher.pattern as { pattern: string }).pattern, /\//);
      }
      // `vars` files report every event; the `vars` folder and the root only create/delete.
      assert.deepEqual(
        watchers.slice(WORKSPACE_WATCHERS.length).map((watcher) => watcher.ignored),
        [
          [false, false, false],
          [false, true, false],
          [false, false, false],
          [false, true, false],
          [false, true, false],
          [false, true, false],
          [false, true, false]
        ]
      );
      index.dispose();
    });

    it("does not watch a configured root that is a workspace folder", async () => {
      setWorkspaceFolders("/ws/acme");
      addFile("/ws/acme/vars/deploy.groovy", "def call() {}");
      const index = createIndex([{ name: "acme-lib", path: "/ws/acme" }]);

      await index.getLibraries();
      assert.deepEqual(describeWatchers(), WORKSPACE_WATCHERS);
      index.dispose();
    });

    it("reloads when an outside root changes", async () => {
      addFile("/abs/lib/vars/one.groovy", "def call() {}");
      const index = createIndex([{ name: "abs", path: "/abs/lib" }]);

      assert.deepEqual((await index.getLibraries())[0].varNames, ["one"]);
      const varsFiles = watchers[3];
      addFile("/abs/lib/vars/two.groovy", "def call() {}");
      fire(varsFiles, "create", "/abs/lib/vars/two.groovy");
      assert.deepEqual((await index.getLibraries())[0].varNames, ["one", "two"]);

      files.set("/abs/lib/vars/two.groovy", "def call(String value) {}");
      fire(varsFiles, "change", "/abs/lib/vars/two.groovy");
      assert.equal((await index.getVar("abs", "two"))?.signatures[0].label, "two(value: String)");

      files.delete("/abs/lib/vars/one.groovy");
      fire(varsFiles, "delete", "/abs/lib/vars/one.groovy");
      assert.deepEqual((await index.getLibraries())[0].varNames, ["two"]);

      // The same root keeps its watchers across reloads.
      assert.equal(calls.watchers, 6);
      index.dispose();
    });

    it("reloads when the vars folder of an outside root is created or deleted", async () => {
      directories.add("/abs");
      directories.add("/abs/lib");
      const index = createIndex([{ name: "abs", path: "/abs/lib" }]);

      // A configured root without `vars/` still loads, so its `vars` folder is watched.
      assert.deepEqual((await index.getLibraries())[0].varNames, []);
      const varsFolder = watchers[4];
      assert.equal(describeWatchers()[4][0], "/abs/lib vars");

      addFile("/abs/lib/vars/one.groovy", "def call() {}");
      fire(varsFolder, "create", "/abs/lib/vars");
      assert.deepEqual((await index.getLibraries())[0].varNames, ["one"]);
      // The vars watchers are rebuilt now that the folder exists, so they watch a real path.
      assert.equal(watchers[3].disposed, true);
      assert.equal(watchers[4].disposed, true);
      assert.equal(calls.watchers, 8);
      const rebuiltVarsFolder = watchers[7];
      assert.equal(describeWatchers()[7][0], "/abs/lib vars");

      files.delete("/abs/lib/vars/one.groovy");
      directories.delete("/abs/lib/vars");
      fire(rebuiltVarsFolder, "delete", "/abs/lib/vars");
      assert.deepEqual((await index.getLibraries())[0].varNames, []);
      assert.equal(calls.watchers, 10);
      index.dispose();
    });

    it("disposes watchers for removed roots and creates them for new ones on reload", async () => {
      addFile("/abs/one/vars/a.groovy", "def call() {}");
      addFile("/abs/two/vars/b.groovy", "def call() {}");
      let entries: ConfigEntry[] = [{ name: "one", path: "/abs/one" }];
      const index = new JenkinsSharedLibraryIndex(() => entries);

      await index.getLibraries();
      entries = [{ name: "two", path: "/abs/two" }];
      index.invalidate();
      // Invalidation alone does not touch watchers; the next load does.
      assert.equal(watchers[3].disposed, false);
      await index.getLibraries();

      assert.deepEqual(describeWatchers(), [
        ...WORKSPACE_WATCHERS,
        ["/abs/one/vars *.{groovy,txt}", true],
        ["/abs/one vars", true],
        ["/abs one", true],
        ["/abs/two/vars *.{groovy,txt}", false],
        ["/abs/two vars", false],
        ["/abs two", false]
      ]);
      for (const watcher of watchers.slice(3, 6)) {
        assert.equal(watcher.handlers.create.length + watcher.handlers.delete.length, 0);
      }
      assert.equal(watchers[3].handlers.change.length, 0);
      index.dispose();
    });

    it("leaves watchers alone when a stale load finishes", async () => {
      addFile("/abs/one/vars/a.groovy", "def call() {}");
      const index = createIndex([{ name: "one", path: "/abs/one" }]);
      let release: () => void = () => {};
      gate = new Promise((resolve) => {
        release = resolve;
      });

      const stale = index.getLibraries();
      await Promise.resolve();
      index.invalidate();
      gate = undefined;
      release();
      await stale;
      assert.deepEqual(describeWatchers(), WORKSPACE_WATCHERS);

      await index.getLibraries();
      assert.equal(calls.watchers, 6);
      index.dispose();
    });

    it("disposes outside-root watchers on dispose", async () => {
      addFile("/abs/lib/vars/one.groovy", "def call() {}");
      const index = createIndex([{ name: "abs", path: "/abs/lib" }]);
      await index.getLibraries();
      assert.equal(watchers.length, 6);

      index.dispose();
      assert.deepEqual(
        describeWatchers().map(([, disposed]) => disposed),
        [true, true, true, true, true, true]
      );
      for (const watcher of watchers) {
        const { create, change, delete: deleted } = watcher.handlers;
        assert.equal(create.length + change.length + deleted.length, 0);
      }

      await index.getLibraries();
      assert.equal(calls.watchers, 6);
    });

    it("loads a configured root that was missing once it is created", async () => {
      directories.add("/libs");
      const index = createIndex([{ name: "ext", path: "/libs/ext" }]);

      assert.deepEqual(await index.getLibraries(), []);
      assert.deepEqual(describeWatchers(), [...WORKSPACE_WATCHERS, ["/libs ext", false]]);
      const parentWatcher = watchers[3];
      assert.deepEqual(parentWatcher.ignored, [false, true, false]);

      addFile("/libs/ext/vars/tool.groovy", "def call() {}");
      fire(parentWatcher, "create", "/libs/ext");
      assert.deepEqual(
        (await index.getLibraries()).map((library) => [library.name, library.varNames]),
        [["ext", ["tool"]]]
      );
      // The root now loads, so its vars folder and files are watched too.
      assert.deepEqual(describeWatchers().slice(3), [
        ["/libs ext", false],
        ["/libs/ext/vars *.{groovy,txt}", false],
        ["/libs/ext vars", false]
      ]);

      files.delete("/libs/ext/vars/tool.groovy");
      directories.delete("/libs/ext/vars");
      directories.delete("/libs/ext");
      fire(parentWatcher, "delete", "/libs/ext");
      assert.deepEqual(await index.getLibraries(), []);
      // Once the root is gone again, only the parent watcher remains.
      assert.deepEqual(describeWatchers().slice(3), [
        ["/libs ext", false],
        ["/libs/ext/vars *.{groovy,txt}", true],
        ["/libs/ext vars", true]
      ]);
      index.dispose();
    });
  });

  describe("folder-level deletes inside the workspace", () => {
    async function loadedIndex() {
      setWorkspaceFolders("/ws/main");
      addFile("/ws/main/libs/acme/vars/deploy.groovy", "def call() {}");
      addFile("/ws/main/app/Jenkinsfile", "pipeline {}");
      const index = createIndex([{ name: "acme", path: "libs/acme" }]);
      assert.deepEqual(
        (await index.getLibraries()).map((library) => library.name),
        ["acme"]
      );
      return index;
    }

    it("reloads when a library root, its vars folder, or a folder above it is deleted", async () => {
      for (const deleted of ["/ws/main/libs/acme/vars", "/ws/main/libs/acme", "/ws/main/libs"]) {
        const index = await loadedIndex();
        const reads = calls.readDirectory;
        fire(watchers[2], "delete", deleted);
        await index.getLibraries();
        assert.equal(calls.readDirectory, reads + 2, deleted);
        index.dispose();
        watchers.length = 0;
      }
    });

    it("reloads when a vars folder is created or deleted", async () => {
      const index = await loadedIndex();
      assert.equal(watchers[1].pattern, "**/vars");
      const reads = calls.readDirectory;
      fire(watchers[1], "create", "/ws/main/other/vars");
      await index.getLibraries();
      assert.equal(calls.readDirectory, reads + 2);
      index.dispose();
    });

    it("ignores unrelated deletes", async () => {
      const index = await loadedIndex();
      const reads = calls.readDirectory;
      for (const deleted of [
        "/ws/main/app",
        "/ws/main/libs/acme/src",
        "/ws/main/libs/acme/vars-old",
        "/ws/main/libs/acmeTools"
      ]) {
        fire(watchers[2], "delete", deleted);
      }
      await index.getLibraries();
      assert.equal(calls.readDirectory, reads);
      index.dispose();
    });
  });
});
