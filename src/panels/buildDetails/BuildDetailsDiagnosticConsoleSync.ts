import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { BuildDetailsBackend } from "./BuildDetailsBackend";
import { truncateConsoleText } from "./BuildDetailsFormatters";
import type { ConsoleTextByteRange } from "./ConsoleStreamManager";

interface DiagnosticConsoleSyncContext {
  backend: BuildDetailsBackend["console"];
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  loadToken: number;
  syncGeneration: number;
}

interface DiagnosticConsoleSyncRange {
  append: boolean;
  start: number;
  end: number;
}

export interface BuildDetailsDiagnosticConsoleSyncOptions {
  maxConsoleChars: number;
  getBackend: () => BuildDetailsBackend["console"] | undefined;
  getEnvironment: () => JenkinsEnvironmentRef | undefined;
  getBuildUrl: () => string | undefined;
  getLoadToken: () => number;
  isLoadTokenCurrent: (token: number) => boolean;
  onTextChanged?: () => void;
}

export class BuildDetailsDiagnosticConsoleSync {
  private text = "";
  private syncGeneration = 0;
  private syncQueue: Promise<void> = Promise.resolve();
  private textSynchronized = true;

  constructor(private readonly options: BuildDetailsDiagnosticConsoleSyncOptions) {}

  getText(): string {
    return this.text;
  }

  reset(): void {
    this.syncGeneration += 1;
    this.syncQueue = Promise.resolve();
    this.textSynchronized = true;
    this.applyText("");
  }

  dispose(): void {
    this.syncGeneration += 1;
  }

  setText(text: string): void {
    this.syncGeneration += 1;
    this.applyText(text);
    this.textSynchronized = true;
  }

  appendAndNotify(text: string): void {
    this.setText(this.text + text);
    this.options.onTextChanged?.();
  }

  replaceAndNotify(text: string): void {
    this.setText(text);
    this.options.onTextChanged?.();
  }

  sync(textRange: ConsoleTextByteRange, appendedTextRange?: ConsoleTextByteRange): Promise<void> {
    const backend = this.options.getBackend();
    const environment = this.options.getEnvironment();
    const buildUrl = this.options.getBuildUrl();
    if (!backend || !environment || !buildUrl) {
      return Promise.resolve();
    }
    if (!appendedTextRange) {
      this.syncGeneration += 1;
    }
    const operation: DiagnosticConsoleSyncContext = {
      backend,
      environment,
      buildUrl,
      loadToken: this.options.getLoadToken(),
      syncGeneration: this.syncGeneration
    };
    const sync = () => this.performSync(operation, textRange, appendedTextRange);
    const queued = this.syncQueue.then(sync, sync);
    this.syncQueue = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  private async performSync(
    operation: DiagnosticConsoleSyncContext,
    textRange: ConsoleTextByteRange,
    appendedTextRange: ConsoleTextByteRange | undefined
  ): Promise<void> {
    if (!this.isCurrent(operation)) {
      return;
    }
    const range = this.resolveRange(textRange, appendedTextRange);
    if (range.end === range.start) {
      this.applyEmptySync(range.append);
      return;
    }
    try {
      const result = await operation.backend.getConsoleTextProgressive(
        operation.environment,
        operation.buildUrl,
        range.start,
        range.end - range.start
      );
      if (this.isCurrent(operation)) {
        this.applySuccessfulSync(result.text, range.append);
      }
    } catch {
      if (this.isCurrent(operation)) {
        this.applyFailedSync();
      }
    }
  }

  private resolveRange(
    textRange: ConsoleTextByteRange,
    appendedTextRange: ConsoleTextByteRange | undefined
  ): DiagnosticConsoleSyncRange {
    const append = Boolean(appendedTextRange && this.textSynchronized);
    const requestedRange = append ? appendedTextRange : textRange;
    const start = Math.max(0, Math.floor(requestedRange?.start ?? 0));
    const end = Math.max(start, Math.floor(requestedRange?.end ?? start));
    return { append, start, end };
  }

  private isCurrent(operation: DiagnosticConsoleSyncContext): boolean {
    return (
      operation.syncGeneration === this.syncGeneration &&
      this.options.isLoadTokenCurrent(operation.loadToken)
    );
  }

  private applyEmptySync(append: boolean): void {
    if (append) {
      return;
    }
    this.applyText("");
    this.textSynchronized = true;
    this.options.onTextChanged?.();
  }

  private applySuccessfulSync(text: string, append: boolean): void {
    this.applyText(append ? this.text + text : text);
    this.textSynchronized = true;
    this.options.onTextChanged?.();
  }

  private applyFailedSync(): void {
    this.applyText("");
    this.textSynchronized = false;
    this.options.onTextChanged?.();
  }

  private applyText(text: string): void {
    this.text = truncateConsoleText(text, this.options.maxConsoleChars).text;
  }
}
