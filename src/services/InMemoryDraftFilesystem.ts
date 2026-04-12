import * as vscode from "vscode";

type DraftEntry = {
  content: Uint8Array;
  mtime: number;
};

export abstract class InMemoryDraftFilesystem implements vscode.FileSystemProvider {
  private readonly drafts = new Map<string, DraftEntry>();
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  protected constructor(
    private readonly scheme: string,
    private readonly renameErrorMessage: string
  ) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const entry = this.getEntry(uri);
    return {
      type: vscode.FileType.File,
      ctime: entry.mtime,
      mtime: entry.mtime,
      size: entry.content.byteLength
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {}

  readFile(uri: vscode.Uri): Uint8Array {
    return this.getEntry(uri).content;
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    this.updateEntry(uri, content);
  }

  delete(uri: vscode.Uri): void {
    this.drafts.delete(uri.path);
    this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions(this.renameErrorMessage);
  }

  protected createDraftFile(path: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: this.scheme, path });
    this.drafts.set(uri.path, {
      content: Buffer.from(content, "utf8"),
      mtime: Date.now()
    });
    return uri;
  }

  updateDraftContent(uri: vscode.Uri, content: string): void {
    this.updateEntry(uri, Buffer.from(content, "utf8"));
  }

  getDraftContent(uri: vscode.Uri): string | undefined {
    const entry = this.drafts.get(uri.path);
    if (!entry) {
      return undefined;
    }
    return Buffer.from(entry.content).toString("utf8");
  }

  hasDraft(uri: vscode.Uri): boolean {
    return this.drafts.has(uri.path);
  }

  removeDraft(uri: vscode.Uri): void {
    this.drafts.delete(uri.path);
  }

  private getEntry(uri: vscode.Uri): DraftEntry {
    const entry = this.drafts.get(uri.path);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry;
  }

  private updateEntry(uri: vscode.Uri, content: Uint8Array): void {
    const entry = this.getEntry(uri);
    entry.content = content;
    entry.mtime = Date.now();
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }
}
