import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

const tabChangeListeners = new Set();
const tabGroup = {
  isActive: true,
  viewColumn: 1,
  activeTab: undefined,
  tabs: []
};
const commandCalls = [];

class Disposable {
  constructor(dispose) {
    this.dispose = dispose;
  }
}

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener) => {
      this.listeners.add(listener);
      return new Disposable(() => this.listeners.delete(listener));
    };
  }
}

class Uri {
  constructor(scheme, path) {
    this.scheme = scheme;
    this.path = path;
  }

  static from(components) {
    return new Uri(components.scheme, components.path);
  }

  toString() {
    return `${this.scheme}:${this.path}`;
  }
}

function createFileSystemError(label, message) {
  const error = new Error(message);
  error.name = label;
  error.code = label;
  return error;
}

const vscodeStub = {
  commands: {
    executeCommand: async (command, uri, options) => {
      commandCalls.push({ command, uri, options });
      const tab = {
        label: "preview",
        group: tabGroup,
        input: { uri },
        isActive: true,
        isDirty: false,
        isPinned: false,
        isPreview: true
      };
      tabGroup.activeTab = tab;
      tabGroup.tabs = [...tabGroup.tabs, tab];
      return undefined;
    }
  },
  Disposable,
  EventEmitter,
  FileSystemError: {
    FileNotFound: (uri) => createFileSystemError("FileNotFound", `File not found: ${uri}`),
    NoPermissions: (message) => createFileSystemError("NoPermissions", message)
  },
  FileType: {
    File: 1,
    Directory: 2
  },
  Uri,
  window: {
    tabGroups: {
      all: [tabGroup],
      activeTabGroup: tabGroup,
      onDidChangeTabs: (listener) => {
        tabChangeListeners.add(listener);
        return new Disposable(() => tabChangeListeners.delete(listener));
      }
    }
  },
  workspace: {
    onDidCloseTextDocument: () => new Disposable(() => undefined)
  },
  languages: {
    setTextDocumentLanguage: async (document) => document
  }
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ArtifactPreviewProvider } = await import("../out/ui/ArtifactPreviewProvider.js");
const { openBufferedContentPreview } = await import("../out/ui/BufferedContentPreviewer.js");
Module._load = originalLoad;

function resetTabs() {
  commandCalls.length = 0;
  tabChangeListeners.clear();
  tabGroup.activeTab = undefined;
  tabGroup.tabs = [];
}

function closeTabForUri(uri) {
  const tab = tabGroup.tabs.find((candidate) => candidate.input.uri.toString() === uri.toString());
  assert.ok(tab, "Expected preview tab to be open.");
  tabGroup.tabs = tabGroup.tabs.filter((candidate) => candidate !== tab);
  tabGroup.activeTab = tabGroup.tabs[tabGroup.tabs.length - 1];
  for (const listener of [...tabChangeListeners]) {
    listener({ opened: [], closed: [tab], changed: [] });
  }
}

test("registerArtifact keeps an oversized new artifact readable", () => {
  const provider = new ArtifactPreviewProvider({ maxEntries: 1, maxTotalBytes: 1 });
  const uri = provider.registerArtifact(new Uint8Array([1, 2]), "artifact.txt");

  assert.deepEqual([...provider.readFile(uri)], [1, 2]);
  assert.equal(provider.stat(uri).size, 2);
});

test("registerArtifact keeps a new artifact readable when existing entries are in use", () => {
  const provider = new ArtifactPreviewProvider({ maxEntries: 1, maxTotalBytes: 10 });
  const firstUri = provider.registerArtifact(new Uint8Array([1]), "first.txt");
  provider.markInUse(firstUri);

  const secondUri = provider.registerArtifact(new Uint8Array([2]), "second.txt");

  assert.deepEqual([...provider.readFile(firstUri)], [1]);
  assert.deepEqual([...provider.readFile(secondUri)], [2]);
});

test("image previews stay in use until their preview tab closes", async () => {
  resetTabs();
  const provider = new ArtifactPreviewProvider({ maxEntries: 1, maxTotalBytes: 2 });

  await openBufferedContentPreview(
    provider,
    { data: new Uint8Array([1, 2]), headers: { "content-type": "image/png" } },
    "artifact.png"
  );
  const imageUri = commandCalls[0].uri;

  provider.registerArtifact(new Uint8Array([3, 4]), "other.txt");
  assert.deepEqual([...provider.readFile(imageUri)], [1, 2]);

  closeTabForUri(imageUri);
  provider.registerArtifact(new Uint8Array([5, 6]), "third.txt");

  assert.throws(() => provider.readFile(imageUri), /File not found/);
});
