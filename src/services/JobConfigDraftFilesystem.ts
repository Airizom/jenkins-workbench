import * as vscode from "vscode";

export const JOB_CONFIG_DRAFT_SCHEME = "jenkins-config";

type DraftEntry = {
  content: Uint8Array;
  mtime: number;
};

export class JobConfigDraftFilesystem implements vscode.FileSystemProvider {
  private readonly drafts = new Map<string, DraftEntry>();
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const entry = this.drafts.get(uri.path);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
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
    const entry = this.drafts.get(uri.path);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry.content;
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    const existing = this.drafts.get(uri.path);
    if (!existing) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    existing.content = content;
    existing.mtime = Date.now();
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(uri: vscode.Uri): void {
    this.drafts.delete(uri.path);
    this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Renaming job config drafts is not supported.");
  }

  createDraft(label: string, content: string): vscode.Uri {
    const safeLabel =
      label
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .slice(0, 40) || "job";
    const filename = `jenkins-${safeLabel}-config-${Date.now()}.xml`;
    const uri = vscode.Uri.from({ scheme: JOB_CONFIG_DRAFT_SCHEME, path: `/${filename}` });

    this.drafts.set(uri.path, {
      content: Buffer.from(content, "utf8"),
      mtime: Date.now()
    });

    return uri;
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
}
