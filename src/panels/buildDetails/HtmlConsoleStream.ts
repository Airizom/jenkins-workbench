import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsConsoleTextTail, JenkinsProgressiveConsoleHtml } from "../../jenkins/types";

const HTML_BUFFER_MULTIPLIER = 2;
const HTML_RETRY_COOLDOWN_MS = 30000;

export interface HtmlConsoleStreamCallbacks {
  onConsoleHtmlAppend(html: string): void;
  onConsoleHtmlSet(payload: { html: string; truncated: boolean }): void;
}

export interface HtmlConsoleStreamDataService {
  getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml>;
}

export interface HtmlConsoleStreamOptions {
  dataService: HtmlConsoleStreamDataService;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  maxConsoleChars: number;
  callbacks: HtmlConsoleStreamCallbacks;
}

export type HtmlConsoleSnapshot = {
  html: string;
  truncated: boolean;
  start: number;
  textSize: number;
  annotator?: string;
};

export async function fetchConsoleHtmlSnapshot(
  dataService: HtmlConsoleStreamDataService,
  environment: JenkinsEnvironmentRef,
  buildUrl: string,
  consoleTextResult: JenkinsConsoleTextTail | undefined
): Promise<HtmlConsoleSnapshot | undefined> {
  const htmlStart = consoleTextResult
    ? Math.max(0, consoleTextResult.nextStart - consoleTextResult.text.length)
    : 0;
  const htmlResult = await dataService.getConsoleHtmlProgressive(environment, buildUrl, htmlStart);
  if (!htmlResult.textSizeKnown) {
    return undefined;
  }
  return {
    html: htmlResult.html,
    truncated: Boolean(consoleTextResult?.truncated) || htmlStart > 0,
    start: htmlStart,
    textSize: htmlResult.textSize,
    annotator: htmlResult.annotator
  };
}

export class HtmlConsoleStream {
  private readonly dataService: HtmlConsoleStreamDataService;
  private readonly environment: JenkinsEnvironmentRef;
  private readonly buildUrl: string;
  private readonly maxConsoleChars: number;
  private readonly maxHtmlBufferChars: number;
  private readonly callbacks: HtmlConsoleStreamCallbacks;
  private consoleHtmlOffset = 0;
  private consoleHtmlStart = 0;
  private consoleHtmlBuffer = "";
  private consoleHtmlSupported = false;
  private consoleAnnotator: string | undefined;
  private consoleHtmlNeedsReset = false;
  private nextProbeAt = 0;

  constructor(options: HtmlConsoleStreamOptions) {
    this.dataService = options.dataService;
    this.environment = options.environment;
    this.buildUrl = options.buildUrl;
    this.maxConsoleChars = options.maxConsoleChars;
    this.maxHtmlBufferChars = Math.max(
      this.maxConsoleChars,
      this.maxConsoleChars * HTML_BUFFER_MULTIPLIER
    );
    this.callbacks = options.callbacks;
  }

  isSupported(): boolean {
    return this.consoleHtmlSupported;
  }

  shouldProbe(now = Date.now()): boolean {
    return !this.consoleHtmlSupported && now >= this.nextProbeAt;
  }

  shouldContinuePolling(): boolean {
    return this.consoleHtmlSupported && this.consoleHtmlNeedsReset;
  }

  async tryInitialize(
    consoleTextResult: JenkinsConsoleTextTail | undefined
  ): Promise<{ html: string; truncated: boolean } | undefined> {
    try {
      const snapshot = await fetchConsoleHtmlSnapshot(
        this.dataService,
        this.environment,
        this.buildUrl,
        consoleTextResult
      );
      if (!snapshot) {
        this.handleError();
        return undefined;
      }
      this.consoleHtmlBuffer = snapshot.html;
      this.consoleHtmlOffset = snapshot.textSize;
      this.consoleHtmlStart = snapshot.start;
      this.consoleHtmlSupported = true;
      this.consoleAnnotator = snapshot.annotator;
      this.consoleHtmlNeedsReset = false;
      this.nextProbeAt = 0;
      return {
        html: snapshot.html,
        truncated: snapshot.truncated
      };
    } catch {
      this.handleError();
      return undefined;
    }
  }

  disable(): void {
    this.consoleHtmlSupported = false;
    this.consoleAnnotator = undefined;
    this.consoleHtmlNeedsReset = false;
    this.consoleHtmlStart = 0;
    this.consoleHtmlOffset = 0;
    this.consoleHtmlBuffer = "";
  }

  fetchNext(): Promise<JenkinsProgressiveConsoleHtml> {
    this.ensureConsoleHtmlWindow(this.consoleHtmlOffset);
    return this.dataService.getConsoleHtmlProgressive(
      this.environment,
      this.buildUrl,
      this.consoleHtmlOffset,
      this.consoleAnnotator
    );
  }

  handleError(): void {
    this.disable();
    this.nextProbeAt = Date.now() + HTML_RETRY_COOLDOWN_MS;
  }

  applyResult(chunk: JenkinsProgressiveConsoleHtml): boolean {
    if (!chunk.textSizeKnown) {
      this.handleError();
      return false;
    }
    this.consoleHtmlOffset = chunk.textSize;
    if (chunk.annotator) {
      this.consoleAnnotator = chunk.annotator;
    }
    if (this.consoleHtmlNeedsReset) {
      this.handleResetChunk(chunk);
      return true;
    }
    if (this.shouldResetConsoleHtmlWindow(chunk.textSize)) {
      this.resetConsoleHtmlWindow(Math.max(0, chunk.textSize - this.maxConsoleChars));
      return true;
    }
    if (!chunk.html) {
      return true;
    }
    const nextBufferLength = this.consoleHtmlBuffer.length + chunk.html.length;
    if (this.shouldResetForMarkup(nextBufferLength, chunk.textSize)) {
      this.resetConsoleHtmlWindow(Math.max(0, chunk.textSize - this.maxConsoleChars));
      return true;
    }
    this.consoleHtmlBuffer += chunk.html;
    this.callbacks.onConsoleHtmlAppend(chunk.html);
    return true;
  }

  private handleResetChunk(chunk: JenkinsProgressiveConsoleHtml): void {
    if (!chunk.html) {
      if (!chunk.moreData) {
        this.consoleHtmlBuffer = "";
        this.consoleHtmlNeedsReset = false;
        this.callbacks.onConsoleHtmlSet({
          html: "",
          truncated: this.consoleHtmlStart > 0
        });
      }
      return;
    }
    this.consoleHtmlBuffer = chunk.html;
    this.consoleHtmlNeedsReset = false;
    this.callbacks.onConsoleHtmlSet({
      html: this.consoleHtmlBuffer,
      truncated: this.consoleHtmlStart > 0
    });
  }

  private ensureConsoleHtmlWindow(nextTextSize: number): void {
    if (!this.shouldResetConsoleHtmlWindow(nextTextSize)) {
      return;
    }
    this.resetConsoleHtmlWindow(Math.max(0, nextTextSize - this.maxConsoleChars));
  }

  private shouldResetConsoleHtmlWindow(nextTextSize: number): boolean {
    if (!Number.isFinite(this.maxConsoleChars) || this.maxConsoleChars <= 0) {
      return false;
    }
    if (nextTextSize <= this.consoleHtmlStart) {
      return false;
    }
    return nextTextSize - this.consoleHtmlStart > this.maxConsoleChars;
  }

  private shouldResetForMarkup(nextBufferLength: number, nextTextSize: number): boolean {
    if (!Number.isFinite(this.maxHtmlBufferChars) || this.maxHtmlBufferChars <= 0) {
      return false;
    }
    if (nextBufferLength <= this.maxHtmlBufferChars) {
      return false;
    }
    const desiredStart = Math.max(0, nextTextSize - this.maxConsoleChars);
    return desiredStart > this.consoleHtmlStart;
  }

  private resetConsoleHtmlWindow(start: number): void {
    const safeStart = Math.max(0, start);
    this.consoleHtmlStart = safeStart;
    this.consoleHtmlOffset = safeStart;
    this.consoleHtmlBuffer = "";
    this.consoleAnnotator = undefined;
    this.consoleHtmlNeedsReset = true;
  }
}
