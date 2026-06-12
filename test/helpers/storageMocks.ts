import type * as vscode from "vscode";

export interface FakeSecretStorage extends vscode.SecretStorage {
  readonly values: Map<string, string>;
}

function createFakeMemento(): vscode.Memento {
  const storage = new Map<string, unknown>();
  return {
    get: <T>(key: string): T | undefined => storage.get(key) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      storage.set(key, value);
    },
    keys: (): readonly string[] => [...storage.keys()]
  };
}

export function createFakeSecretStorage(): FakeSecretStorage {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key: string): Promise<string | undefined> => values.get(key),
    store: async (key: string, value: string): Promise<void> => {
      values.set(key, value);
    },
    delete: async (key: string): Promise<void> => {
      values.delete(key);
    },
    keys: async (): Promise<string[]> => [...values.keys()],
    onDidChange: () => ({ dispose: () => undefined })
  };
}

export function createExtensionContext(options?: {
  workspaceState?: vscode.Memento;
  globalState?: vscode.Memento;
  secrets?: vscode.SecretStorage;
}): vscode.ExtensionContext {
  return {
    workspaceState: options?.workspaceState ?? createFakeMemento(),
    globalState: options?.globalState ?? createFakeMemento(),
    secrets: options?.secrets ?? createFakeSecretStorage()
  } as unknown as vscode.ExtensionContext;
}
