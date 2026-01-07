import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleText
} from "../../jenkins/types";

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
  }

  reset(): void {
    this.consoleBuffer = "";
    this.consoleTruncated = false;
    this.consoleOffset = 0;
    this.progressiveSupported = false;
    this.forceSnapshot = false;
  }

  resetForFallback(): void {
    this.consoleBuffer = "";
    this.consoleTruncated = false;
    this.consoleOffset = 0;
    this.progressiveSupported = false;
    this.forceSnapshot = true;
  }

  fetchNext(): Promise<JenkinsProgressiveConsoleText | JenkinsConsoleText> {
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
    return this.dataService.getConsoleText(this.environment, this.buildUrl, this.maxConsoleChars);
  }

  handleError(): void {
    if (this.progressiveSupported) {
      this.progressiveSupported = false;
    }
  }

  applyResult(value: JenkinsProgressiveConsoleText | JenkinsConsoleText): void {
    if (this.isProgressive(value)) {
      this.handleProgressiveChunk(value);
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
