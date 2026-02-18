import type { ExtensionToken, ExtensionTokenMap } from "./ExtensionTokenMap";

export type ProviderFactory<K extends ExtensionToken> = (
  container: ExtensionContainer
) => ExtensionTokenMap[K];

export type ProviderRegistry = ExtensionContainer;

export class ExtensionContainer {
  private readonly providers = new Map<ExtensionToken, ProviderFactory<ExtensionToken>>();
  private readonly instances: Partial<ExtensionTokenMap> = {};
  private readonly resolvingStack: ExtensionToken[] = [];
  private locked = false;

  register<K extends ExtensionToken>(token: K, factory: ProviderFactory<K>): void {
    if (this.locked) {
      throw new Error(`Container is immutable. Cannot register provider for '${token}'.`);
    }
    if (this.providers.has(token)) {
      throw new Error(`Provider already registered for token '${token}'.`);
    }
    this.providers.set(token, factory as ProviderFactory<ExtensionToken>);
  }

  seal(): void {
    this.locked = true;
  }

  get<K extends ExtensionToken>(token: K): ExtensionTokenMap[K] {
    const existing = this.instances[token];
    if (existing !== undefined) {
      return existing;
    }

    const factory = this.providers.get(token);
    if (!factory) {
      throw new Error(`Missing provider for token '${token}'.`);
    }

    const cycleIndex = this.resolvingStack.indexOf(token);
    if (cycleIndex >= 0) {
      const cyclePath = [...this.resolvingStack.slice(cycleIndex), token].join(" -> ");
      throw new Error(`Circular dependency detected: ${cyclePath}`);
    }

    this.resolvingStack.push(token);
    try {
      const created = (factory as ProviderFactory<K>)(this);
      this.instances[token] = created;
      return created;
    } finally {
      this.resolvingStack.pop();
    }
  }
}

export function createExtensionContainer(
  registerProviders: (registry: ProviderRegistry) => void
): ExtensionContainer {
  const container = new ExtensionContainer();
  registerProviders(container);
  container.seal();
  return container;
}
