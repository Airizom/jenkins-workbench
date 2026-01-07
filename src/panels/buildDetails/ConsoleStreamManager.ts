import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText
} from "../../jenkins/types";
import { HtmlConsoleStream } from "./HtmlConsoleStream";
import { TextConsoleStream } from "./TextConsoleStream";

export interface ConsoleStreamCallbacks {
  onConsoleAppend(text: string): void;
  onConsoleSet(payload: { text: string; truncated: boolean }): void;
  onConsoleHtmlAppend(html: string): void;
  onConsoleHtmlSet(payload: { html: string; truncated: boolean }): void;
}

export interface ConsoleStreamDataService {
  getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars?: number
  ): Promise<JenkinsConsoleText>;
  getConsoleTextTail(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars: number
  ): Promise<JenkinsConsoleTextTail>;
  getConsoleTextProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number
  ): Promise<JenkinsProgressiveConsoleText>;
  getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml>;
}

export type ConsoleSnapshotResult = {
  consoleTextResult?: JenkinsConsoleTextTail;
  consoleHtmlResult?: { html: string; truncated: boolean };
  consoleError?: unknown;
};

export type ConsoleFetchResult = {
  mode: "html" | "text";
  value?: JenkinsProgressiveConsoleHtml | JenkinsProgressiveConsoleText | JenkinsConsoleText;
  error?: unknown;
};

export interface ConsoleStreamManagerOptions {
  dataService: ConsoleStreamDataService;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  maxConsoleChars: number;
  callbacks: ConsoleStreamCallbacks;
}

export class ConsoleStreamManager {
  private readonly dataService: ConsoleStreamDataService;
  private readonly environment: JenkinsEnvironmentRef;
  private readonly buildUrl: string;
  private readonly maxConsoleChars: number;
  private readonly callbacks: ConsoleStreamCallbacks;
  private readonly textConsoleStream: TextConsoleStream;
  private readonly htmlConsoleStream: HtmlConsoleStream;

  constructor(options: ConsoleStreamManagerOptions) {
    this.dataService = options.dataService;
    this.environment = options.environment;
    this.buildUrl = options.buildUrl;
    this.maxConsoleChars = options.maxConsoleChars;
    this.callbacks = options.callbacks;
    this.textConsoleStream = new TextConsoleStream({
      dataService: options.dataService,
      environment: this.environment,
      buildUrl: this.buildUrl,
      maxConsoleChars: this.maxConsoleChars,
      callbacks: {
        onConsoleAppend: this.callbacks.onConsoleAppend,
        onConsoleSet: this.callbacks.onConsoleSet
      }
    });
    this.htmlConsoleStream = new HtmlConsoleStream({
      dataService: options.dataService,
      environment: this.environment,
      buildUrl: this.buildUrl,
      maxConsoleChars: this.maxConsoleChars,
      callbacks: {
        onConsoleHtmlAppend: this.callbacks.onConsoleHtmlAppend,
        onConsoleHtmlSet: this.callbacks.onConsoleHtmlSet
      }
    });
  }

  shouldContinuePolling(): boolean {
    return this.htmlConsoleStream.shouldContinuePolling();
  }

  async loadInitialConsole(): Promise<ConsoleSnapshotResult> {
    let consoleTextResult: JenkinsConsoleTextTail | undefined;
    let consoleError: unknown;
    try {
      consoleTextResult = await this.dataService.getConsoleTextTail(
        this.environment,
        this.buildUrl,
        this.maxConsoleChars
      );
    } catch (error) {
      consoleError = error;
    }
    this.textConsoleStream.seedFromTail(consoleTextResult);
    let consoleHtmlResult: { html: string; truncated: boolean } | undefined;
    try {
      consoleHtmlResult = await this.htmlConsoleStream.tryInitialize(consoleTextResult);
    } catch {
      consoleHtmlResult = undefined;
    }
    return { consoleTextResult, consoleHtmlResult, consoleError };
  }

  async refreshSnapshot(): Promise<{
    consoleTextResult?: JenkinsConsoleTextTail;
    consoleHtmlResult?: { html: string; truncated: boolean };
  }> {
    const result = await this.loadInitialConsole();
    return { consoleTextResult: result.consoleTextResult, consoleHtmlResult: result.consoleHtmlResult };
  }

  async fetchNext(): Promise<ConsoleFetchResult> {
    let usingHtml = this.htmlConsoleStream.isSupported();
    if (!usingHtml && this.htmlConsoleStream.shouldProbe()) {
      usingHtml = await this.tryProbeHtmlStream();
    }
    if (usingHtml) {
      try {
        const value = await this.htmlConsoleStream.fetchNext();
        return { mode: "html", value };
      } catch (error) {
        this.htmlConsoleStream.handleError();
        this.textConsoleStream.resetForFallback();
        return { mode: "html", error };
      }
    }
    try {
      const value = await this.textConsoleStream.fetchNext();
      return { mode: "text", value };
    } catch (error) {
      this.textConsoleStream.handleError();
      return { mode: "text", error };
    }
  }

  applyResult(
    mode: "html" | "text",
    value: JenkinsProgressiveConsoleHtml | JenkinsProgressiveConsoleText | JenkinsConsoleText
  ): void {
    if (mode === "html") {
      const supported = this.htmlConsoleStream.applyResult(value as JenkinsProgressiveConsoleHtml);
      if (!supported) {
        this.textConsoleStream.resetForFallback();
      }
      return;
    }
    this.textConsoleStream.applyResult(
      value as JenkinsProgressiveConsoleText | JenkinsConsoleText
    );
  }

  private async tryProbeHtmlStream(): Promise<boolean> {
    try {
      const consoleTextResult = await this.dataService.getConsoleTextTail(
        this.environment,
        this.buildUrl,
        this.maxConsoleChars
      );
      const htmlResult = await this.htmlConsoleStream.tryInitialize(consoleTextResult);
      if (!htmlResult) {
        return false;
      }
      this.callbacks.onConsoleHtmlSet({
        html: htmlResult.html,
        truncated: htmlResult.truncated
      });
      return true;
    } catch {
      this.htmlConsoleStream.handleError();
      return false;
    }
  }
}
