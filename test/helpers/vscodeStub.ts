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
  static readonly File = new ThemeIcon("file");
  static readonly Folder = new ThemeIcon("folder");

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

  static from(components: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      components.scheme,
      components.authority ?? "",
      components.path ?? "",
      components.query ?? "",
      components.fragment ?? ""
    );
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

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    const joined = [base.path.replace(/\/+$/, ""), ...pathSegments]
      .join("/")
      .replace(/\/{2,}/g, "/");
    return new Uri(base.scheme, base.authority, joined, "", "");
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

export class Position {
  constructor(
    readonly line: number,
    readonly character: number
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(
    startLineOrPosition: number | Position,
    startCharacterOrEndPosition: number | Position,
    endLine?: number,
    endCharacter?: number
  ) {
    if (
      startLineOrPosition instanceof Position &&
      startCharacterOrEndPosition instanceof Position
    ) {
      this.start = startLineOrPosition;
      this.end = startCharacterOrEndPosition;
      return;
    }
    this.start = new Position(startLineOrPosition as number, startCharacterOrEndPosition as number);
    this.end = new Position(endLine ?? 0, endCharacter ?? 0);
  }
}

export class Selection extends Range {}

export class Location {
  constructor(
    readonly uri: Uri,
    readonly range: Range
  ) {}
}

export class DiagnosticRelatedInformation {
  constructor(
    readonly location: Location,
    readonly message: string
  ) {}
}

export class Diagnostic {
  source?: string;
  code?: string | number;
  relatedInformation?: DiagnosticRelatedInformation[];

  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity?: number
  ) {}
}

export class RelativePattern {
  constructor(
    readonly base: Uri,
    readonly pattern: string
  ) {}
}

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3
} as const;

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64
} as const;

export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3
} as const;
