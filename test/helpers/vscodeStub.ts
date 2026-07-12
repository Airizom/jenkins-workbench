/**
 * Default stub for the `vscode` module in Vitest unit tests.
 *
 * The real module only exists inside the extension host, so
 * `vitest.config.ts` aliases `vscode` to this file. It provides the small
 * set of value classes and enums that pure-logic modules touch at import
 * time. Tests that need richer or observable behavior should override it
 * with `vi.doMock("vscode", () => ({ ...shim }))` before dynamically
 * importing the module under test.
 */

type Listener<T> = (event: T) => void;

export class EventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  readonly event = (listener: Listener<T>): { dispose(): void } => {
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

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor
  ) {}
}

export class TreeItem {
  id?: string;
  contextValue?: string;
  description?: unknown;
  tooltip?: unknown;
  iconPath?: unknown;
  resourceUri?: unknown;
  command?: unknown;

  constructor(
    public label: unknown,
    public collapsibleState?: unknown
  ) {}
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2
} as const;

export class MarkdownString {
  value = "";
  isTrusted?: boolean;
  supportThemeIcons?: boolean;

  constructor(value?: string) {
    this.value = value ?? "";
  }

  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }

  appendText(text: string): this {
    this.value += text;
    return this;
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string
  ) {}

  get fsPath(): string {
    return this.path;
  }

  static file(fsPath: string): Uri {
    return new Uri("file", "", fsPath, "", "");
  }

  static parse(value: string): Uri {
    const url = new URL(value);
    return new Uri(
      url.protocol.replace(/:$/, ""),
      url.host,
      url.pathname,
      url.search.replace(/^\?/, ""),
      url.hash.replace(/^#/, "")
    );
  }

  with(change: Partial<Pick<Uri, "scheme" | "authority" | "path" | "query" | "fragment">>): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }

  toString(): string {
    const authority = this.authority ? `//${this.authority}` : "//";
    const query = this.query ? `?${this.query}` : "";
    const fragment = this.fragment ? `#${this.fragment}` : "";
    return `${this.scheme}:${authority}${this.path}${query}${fragment}`;
  }
}
