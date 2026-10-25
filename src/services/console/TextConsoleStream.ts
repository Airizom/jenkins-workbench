import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleText
} from "../../jenkins/types";

const MAX_CONSECUTIVE_PROGRESSIVE_ERRORS = 3;
const PROGRESSIVE_RETRY_COOLDOWN_MS = 30000;

export interface TextConsoleStreamCallbacks {
  onConsoleAppend(text: string): void;
  onConsoleSet(payload: { text: string; truncated: boolean }): void;
}

export interface TextConsoleStreamDataService {
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
}

export interface TextConsoleStreamOptions {
  dataService: TextConsoleStreamDataService;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  maxConsoleChars: number;
  callbacks: TextConsoleStreamCallbacks;
}

export class TextConsoleStream {
  private readonly dataService: TextConsoleStreamDataService;
  private readonly environment: JenkinsEnvironmentRef;
  private readonly buildUrl: string;
  private readonly maxConsoleChars: number;
  private readonly callbacks: TextConsoleStreamCallbacks;
  private consoleOffset = 0;
  private consoleBuffer = "";
  private consoleTruncated = false;
  private progressiveSupported = false;
  private forceSnapshot = false;
  private progressiveErrorCount = 0;
  private progressiveRetryAt: number | undefined;

  constructor(options: TextConsoleStreamOptions) {
    this.dataService = options.dataService;
    this.environment = options.environment;
    this.buildUrl = options.buildUrl;
    this.maxConsoleChars = options.maxConsoleChars;
    this.callbacks = options.callbacks;
  }

  seedFromTail(result: JenkinsConsoleTextTail | undefined): void {
    if (!result) {
      this.reset();
      return;
    }
    this.consoleBuffer = result.text;
    this.consoleTruncated = result.truncated;
    this.consoleOffset = result.nextStart;
    this.progressiveSupported = result.progressiveSupported;
    this.progressiveErrorCount = 0;
    this.progressiveRetryAt = undefined;
  }

  reset(): void {
    this.consoleBuffer = "";
    this.consoleTruncated = false;
    this.consoleOffset = 0;
    this.progressiveSupported = false;
    this.forceSnapshot = false;
    this.progressiveErrorCount = 0;
    this.progressiveRetryAt = undefined;
  }

  resetForFallback(): void {
    this.reset();
    this.forceSnapshot = true;
  }

  fetchNext(now = Date.now()): Promise<JenkinsProgressiveConsoleText | JenkinsConsoleText> {
    if (this.forceSnapshot) {
      this.forceSnapshot = false;
      return this.dataService.getConsoleText(this.environment, this.buildUrl, this.maxConsoleChars);
    }
    if (this.progressiveSupported) {
      return this.dataService.getConsoleTextProgressive(
        this.environment,
        this.buildUrl,
        this.consoleOffset
      );
    }
    if (this.progressiveRetryAt !== undefined && now >= this.progressiveRetryAt) {
      // Re-seed from the tail so the byte offset comes from the server, not the string length.
      this.progressiveRetryAt = now + PROGRESSIVE_RETRY_COOLDOWN_MS;
      return this.dataService.getConsoleTextTail(
        this.environment,
        this.buildUrl,
        this.maxConsoleChars
      );
    }
    return this.dataService.getConsoleText(this.environment, this.buildUrl, this.maxConsoleChars);
  }

  handleError(now = Date.now()): void {
    if (!this.progressiveSupported) {
      return;
    }
    // A failed progressive request does not advance the offset, so transient errors retry in place.
    this.progressiveErrorCount += 1;
    if (this.progressiveErrorCount < MAX_CONSECUTIVE_PROGRESSIVE_ERRORS) {
      return;
    }
    this.progressiveSupported = false;
    this.progressiveErrorCount = 0;
    this.progressiveRetryAt = now + PROGRESSIVE_RETRY_COOLDOWN_MS;
  }

  applyResult(value: JenkinsProgressiveConsoleText | JenkinsConsoleText): void {
    if (this.isProgressive(value)) {
      this.progressiveErrorCount = 0;
      this.handleProgressiveChunk(value);
    } else if (this.isTail(value)) {
      this.seedFromTail(value);
      this.callbacks.onConsoleSet({
        text: this.consoleBuffer,
        truncated: this.consoleTruncated
      });
    } else {
      this.consoleBuffer = value.text;
      this.consoleTruncated = value.truncated;
      this.consoleOffset = this.consoleBuffer.length;
      this.callbacks.onConsoleSet({
        text: this.consoleBuffer,
        truncated: this.consoleTruncated
      });
    }
  }

  private isProgressive(
    value: JenkinsProgressiveConsoleText | JenkinsConsoleText
  ): value is JenkinsProgressiveConsoleText {
    return "textSize" in value;
  }

  private isTail(
    value: JenkinsProgressiveConsoleText | JenkinsConsoleText
  ): value is JenkinsConsoleTextTail {
    return "nextStart" in value;
  }

  private handleProgressiveChunk(chunk: JenkinsProgressiveConsoleText): void {
    this.consoleOffset = chunk.textSize;
    if (!chunk.text) {
      return;
    }

    const nextBuffer = this.consoleBuffer + chunk.text;
    if (nextBuffer.length > this.maxConsoleChars) {
      this.consoleBuffer = nextBuffer.slice(nextBuffer.length - this.maxConsoleChars);
      this.consoleTruncated = true;
      this.callbacks.onConsoleSet({
        text: this.consoleBuffer,
        truncated: true
      });
      return;
    }

    this.consoleBuffer = nextBuffer;
    this.callbacks.onConsoleAppend(chunk.text);
  }
}
