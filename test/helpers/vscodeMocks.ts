type Disposable = { dispose(): void };

type TestEventEmitterConstructor = new <T>() => {
  readonly event: (listener: (event: T) => void) => Disposable;
  fire(event: T): void;
  dispose(): void;
};

class TestEventEmitter<T> {
  private readonly listeners = new Set<(event: T) => void>();

  readonly event = (listener: (event: T) => void): Disposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export interface TestUriLike {
  readonly scheme: string;
  readonly authority: string;
  readonly fsPath: string;
  toString(): string;
}

class TestUriInstance implements TestUriLike {
  readonly scheme = "file";
  readonly authority = "";

  private constructor(readonly fsPath: string) {}

  static file(fsPath: string): TestUriInstance {
    return new TestUriInstance(fsPath);
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
}

export const TestUri = {
  file(fsPath: string): TestUriLike {
    return TestUriInstance.file(fsPath);
  }
};

export function createEventEmitterVscodeMock(): { EventEmitter: TestEventEmitterConstructor } {
  return { EventEmitter: TestEventEmitter };
}

export function createCurrentBranchVscodeMock(options?: {
  activeTextEditor?: { document: { uri: TestUriLike } };
  githubPullRequestExtension?: () => unknown;
}): {
  EventEmitter: TestEventEmitterConstructor;
  extensions: { getExtension(): unknown };
  Uri: typeof TestUri;
  window: {
    activeTextEditor?: { document: { uri: TestUriLike } };
    onDidChangeActiveTextEditor(): { dispose(): void };
  };
  workspace: { onDidChangeWorkspaceFolders(): { dispose(): void } };
} {
  return {
    EventEmitter: TestEventEmitter,
    window: {
      activeTextEditor: options?.activeTextEditor,
      onDidChangeActiveTextEditor: () => ({ dispose: () => undefined })
    },
    workspace: {
      onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined })
    },
    extensions: {
      getExtension: () => options?.githubPullRequestExtension?.()
    },
    Uri: TestUri
  };
}

export function createThemeVscodeMock(): {
  ThemeColor: new (id: string) => { readonly id: string };
  ThemeIcon: new (id: string, color?: unknown) => { readonly id: string; readonly color?: unknown };
} {
  return {
    ThemeColor: class {
      constructor(readonly id: string) {}
    },
    ThemeIcon: class {
      constructor(
        readonly id: string,
        readonly color?: unknown
      ) {}
    }
  };
}
