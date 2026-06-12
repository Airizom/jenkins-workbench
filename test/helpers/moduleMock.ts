import Module = require("node:module");

type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;

export interface ModuleMock {
  matches(request: string): boolean;
  value: unknown;
}

export function exactModuleMock(requestName: string, value: unknown): ModuleMock {
  return {
    matches: (request) => request === requestName,
    value
  };
}

export function suffixModuleMock(requestSuffix: string, value: unknown): ModuleMock {
  return {
    matches: (request) => request.endsWith(requestSuffix),
    value
  };
}

export function withModuleMocks<T>(mocks: readonly ModuleMock[], load: () => T): T {
  const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
  const originalLoad = moduleWithLoad._load;
  moduleWithLoad._load = (request, parent, isMain) => {
    const mock = mocks.find((entry) => entry.matches(request));
    if (mock) {
      return mock.value;
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return load();
  } finally {
    moduleWithLoad._load = originalLoad;
  }
}
