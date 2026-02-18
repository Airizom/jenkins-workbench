import type { ExtensionToken, ExtensionTokenMap } from "./ExtensionTokenMap";

export type ProviderFactory<K extends ExtensionToken> = (
  container: ExtensionContainer
) => ExtensionTokenMap[K];

export type ExtensionProviderCatalog = {
  [K in ExtensionToken]: ProviderFactory<K>;
};

export type PartialExtensionProviderCatalog = Partial<ExtensionProviderCatalog>;

export type ProviderRegistry = ExtensionContainer;

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer Result
) => void
  ? Result
  : never;

type Simplify<T> = {
  [K in keyof T]: T[K];
};

export type ComposedProviderCatalog<TGroups extends readonly PartialExtensionProviderCatalog[]> =
  Simplify<UnionToIntersection<TGroups[number]>>;

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

export function registerProviderCatalog(
  container: ExtensionContainer,
  catalog: PartialExtensionProviderCatalog
): void {
  for (const token of Object.keys(catalog) as ExtensionToken[]) {
    const factory = catalog[token];
    if (!factory) {
      continue;
    }
    container.register(token, factory as ProviderFactory<ExtensionToken>);
  }
}

export function composeProviderCatalog<TGroups extends readonly PartialExtensionProviderCatalog[]>(
  groups: TGroups
): ComposedProviderCatalog<TGroups> {
  const catalog: PartialExtensionProviderCatalog = {};
  const seenTokens = new Set<ExtensionToken>();
  const duplicateTokens = new Set<ExtensionToken>();

  for (const group of groups as readonly PartialExtensionProviderCatalog[]) {
    for (const token of Object.keys(group) as ExtensionToken[]) {
      const factory = group[token];
      if (!factory) {
        continue;
      }
      if (seenTokens.has(token)) {
        duplicateTokens.add(token);
        continue;
      }
      seenTokens.add(token);
      (catalog as Record<ExtensionToken, ProviderFactory<ExtensionToken> | undefined>)[token] =
        factory as ProviderFactory<ExtensionToken>;
    }
  }

  if (duplicateTokens.size > 0) {
    const duplicates = [...duplicateTokens].sort().join(", ");
    throw new Error(
      `Duplicate provider token registrations found while composing provider catalogs: ${duplicates}`
    );
  }

  return catalog as ComposedProviderCatalog<TGroups>;
}
