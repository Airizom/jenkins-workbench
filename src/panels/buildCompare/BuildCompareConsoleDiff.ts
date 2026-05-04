import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { formatError } from "../buildDetails/BuildDetailsFormatters";
import type { BuildCompareBackend } from "./BuildCompareBackend";
import type { BuildCompareConsoleOptions } from "./BuildCompareOptions";
import type {
  BuildCompareConsoleSectionViewModel,
  BuildCompareConsoleSnippetLine
} from "./shared/BuildCompareContracts";

const LEADING_CONTEXT_LINES = 40;
const TRAILING_CONTEXT_LINES = 80;

interface ConsoleComparisonResult {
  status: BuildCompareConsoleSectionViewModel["status"];
  summaryLabel: string;
  detail?: string;
  divergenceLineLabel?: string;
  baselineLines: BuildCompareConsoleSnippetLine[];
  targetLines: BuildCompareConsoleSnippetLine[];
}

export function createLoadingConsoleComparisonSection(): BuildCompareConsoleSectionViewModel {
  return {
    status: "loading",
    summaryLabel: "Comparing console output",
    detail: "Scanning both build logs for the first divergence.",
    baselineLines: [],
    targetLines: []
  };
}

class ConsoleComparisonReader {
  private nextStart = 0;
  private mode: "progressive" | "full" = "full";
  private loadedFullText = false;
  private loadedBytes = 0;
  public truncatedByLimit = false;

  private constructor(
    private readonly backend: BuildCompareBackend,
    private readonly environment: JenkinsEnvironmentRef,
    private readonly buildUrl: string,
    private readonly maxBytes: number,
    public buffer: string,
    public moreData: boolean
  ) {}

  static async create(
    backend: BuildCompareBackend,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxBytes: number
  ): Promise<ConsoleComparisonReader> {
    try {
      const initial = await backend.console.getConsoleTextProgressive(
        environment,
        buildUrl,
        0,
        maxBytes
      );
      const reader = new ConsoleComparisonReader(
        backend,
        environment,
        buildUrl,
        maxBytes,
        initial.text,
        Boolean(initial.moreData)
      );
      reader.mode = "progressive";
      reader.loadedBytes = initial.bytesRead;
      reader.nextStart = initial.textSize;
      return reader;
    } catch (error) {
      console.debug(
        `Build Compare progressive console fetch failed for ${buildUrl}; falling back to consoleText.`,
        error
      );
      const full = await backend.console.getConsoleTextHead(environment, buildUrl, maxBytes);
      const reader = new ConsoleComparisonReader(
        backend,
        environment,
        buildUrl,
        maxBytes,
        full.text,
        false
      );
      reader.loadedFullText = true;
      reader.loadedBytes = full.bytesRead;
      reader.truncatedByLimit = Boolean(full.truncated);
      return reader;
    }
  }

  async ensureBuffer(): Promise<void> {
    await this.ensureBufferWithLimit();
  }

  async ensureBufferWithLimit(maxBytes?: number): Promise<void> {
    if (this.buffer.length > 0 || !this.moreData || (maxBytes !== undefined && maxBytes <= 0)) {
      return;
    }
    await this.appendNextChunk(maxBytes);
  }

  async appendUntilLineCount(lineCount: number): Promise<void> {
    await this.appendUntilLineCountWithLimit(lineCount);
  }

  async appendUntilLineCountWithLimit(lineCount: number, maxBytes?: number): Promise<void> {
    let remainingBytes = maxBytes;
    while (
      countLineBreaks(this.buffer) < lineCount &&
      this.moreData &&
      (remainingBytes === undefined || remainingBytes > 0)
    ) {
      const beforeLength = this.buffer.length;
      await this.appendNextChunk(remainingBytes);
      const appendedLength = this.buffer.length - beforeLength;
      if (appendedLength <= 0) {
        break;
      }
      if (remainingBytes !== undefined) {
        remainingBytes -= appendedLength;
      }
    }
  }

  consume(length: number): string {
    const value = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return value;
  }

  getRemainingByteBudget(): number {
    return Math.max(0, this.maxBytes - this.loadedBytes);
  }

  private async appendNextChunk(maxBytes?: number): Promise<void> {
    if (this.mode === "progressive") {
      if (!this.moreData) {
        return;
      }
      const next = await this.backend.console.getConsoleTextProgressive(
        this.environment,
        this.buildUrl,
        this.nextStart,
        maxBytes
      );
      this.nextStart = next.textSize;
      this.buffer += next.text;
      this.loadedBytes += next.bytesRead;
      this.moreData = Boolean(next.moreData);
      return;
    }

    if (this.loadedFullText) {
      this.moreData = false;
      return;
    }

    const full = await this.backend.console.getConsoleTextHead(
      this.environment,
      this.buildUrl,
      this.maxBytes
    );
    this.buffer += full.text;
    this.moreData = false;
    this.loadedFullText = true;
    this.loadedBytes += full.bytesRead;
    this.truncatedByLimit = Boolean(full.truncated);
  }
}

export async function buildConsoleComparisonSection(
  backend: BuildCompareBackend,
  options: BuildCompareConsoleOptions,
  environment: JenkinsEnvironmentRef,
  baselineBuildUrl: string,
  targetBuildUrl: string
): Promise<BuildCompareConsoleSectionViewModel> {
  try {
    const baselineReader = await ConsoleComparisonReader.create(
      backend,
      environment,
      baselineBuildUrl,
      options.maxBytes
    );
    const targetReader = await ConsoleComparisonReader.create(
      backend,
      environment,
      targetBuildUrl,
      options.maxBytes
    );
    return await compareConsoleReaders(baselineReader, targetReader, options);
  } catch (error) {
    return {
      status: "error",
      summaryLabel: "Console comparison unavailable",
      detail: formatError(error),
      baselineLines: [],
      targetLines: []
    };
  }
}

async function compareConsoleReaders(
  baselineReader: ConsoleComparisonReader,
  targetReader: ConsoleComparisonReader,
  options: BuildCompareConsoleOptions
): Promise<ConsoleComparisonResult> {
  let comparedChars = 0;
  let comparedLineBreaks = 0;
  let sharedTail = "";

  while (true) {
    await baselineReader.ensureBufferWithLimit(baselineReader.getRemainingByteBudget());
    await targetReader.ensureBufferWithLimit(targetReader.getRemainingByteBudget());

    if (baselineReader.buffer.length === 0 && targetReader.buffer.length === 0) {
      if (
        baselineReader.truncatedByLimit ||
        targetReader.truncatedByLimit ||
        baselineReader.moreData ||
        targetReader.moreData
      ) {
        return buildConsoleTooLargeResult(options);
      }
      return {
        status: "identical",
        summaryLabel: "Console output is identical",
        detail: "Compared in full.",
        baselineLines: [],
        targetLines: []
      };
    }

    if (comparedChars >= options.maxBytes || comparedLineBreaks >= options.maxLines) {
      return buildConsoleTooLargeResult(options);
    }

    const commonLength = getCommonPrefixLength(baselineReader.buffer, targetReader.buffer);
    const minLength = Math.min(baselineReader.buffer.length, targetReader.buffer.length);

    if (commonLength < minLength) {
      const beforeDiff = baselineReader.buffer.slice(0, commonLength);
      const divergenceLine = comparedLineBreaks + countLineBreaks(beforeDiff) + 1;
      const leadingContext = trimToLastLines(sharedTail + beforeDiff, LEADING_CONTEXT_LINES);
      baselineReader.consume(commonLength);
      targetReader.consume(commonLength);
      await baselineReader.appendUntilLineCountWithLimit(
        TRAILING_CONTEXT_LINES,
        baselineReader.getRemainingByteBudget()
      );
      await targetReader.appendUntilLineCountWithLimit(
        TRAILING_CONTEXT_LINES,
        targetReader.getRemainingByteBudget()
      );

      const baselineSnippet = takeFirstLines(
        leadingContext + baselineReader.buffer,
        LEADING_CONTEXT_LINES + TRAILING_CONTEXT_LINES
      );
      const targetSnippet = takeFirstLines(
        leadingContext + targetReader.buffer,
        LEADING_CONTEXT_LINES + TRAILING_CONTEXT_LINES
      );
      const startLineNumber = Math.max(1, divergenceLine - countLineBreaks(leadingContext));
      return buildConsoleDivergenceResult(
        options,
        divergenceLine,
        baselineSnippet,
        targetSnippet,
        startLineNumber
      );
    }

    if (commonLength > 0) {
      const sharedSegment = baselineReader.consume(commonLength);
      targetReader.consume(commonLength);
      const nextLineBreaks = countLineBreaks(sharedSegment);
      if (
        comparedChars + commonLength > options.maxBytes ||
        comparedLineBreaks + nextLineBreaks > options.maxLines
      ) {
        return buildConsoleTooLargeResult(options);
      }
      comparedChars += commonLength;
      comparedLineBreaks += nextLineBreaks;
      sharedTail = trimToLastLines(sharedTail + sharedSegment, LEADING_CONTEXT_LINES);
      continue;
    }

    if (baselineReader.buffer.length === 0 && baselineReader.moreData) {
      continue;
    }
    if (targetReader.buffer.length === 0 && targetReader.moreData) {
      continue;
    }

    if (baselineReader.buffer.length === 0 || targetReader.buffer.length === 0) {
      const divergenceLine = comparedLineBreaks + 1;
      await baselineReader.appendUntilLineCountWithLimit(
        TRAILING_CONTEXT_LINES,
        baselineReader.getRemainingByteBudget()
      );
      await targetReader.appendUntilLineCountWithLimit(
        TRAILING_CONTEXT_LINES,
        targetReader.getRemainingByteBudget()
      );
      const baselineSnippet = takeFirstLines(
        sharedTail + baselineReader.buffer,
        LEADING_CONTEXT_LINES + TRAILING_CONTEXT_LINES
      );
      const targetSnippet = takeFirstLines(
        sharedTail + targetReader.buffer,
        LEADING_CONTEXT_LINES + TRAILING_CONTEXT_LINES
      );
      const startLineNumber = Math.max(1, divergenceLine - countLineBreaks(sharedTail));
      return buildConsoleDivergenceResult(
        options,
        divergenceLine,
        baselineSnippet,
        targetSnippet,
        startLineNumber
      );
    }

    return buildConsoleTooLargeResult(options);
  }
}

function buildConsoleDivergenceResult(
  options: BuildCompareConsoleOptions,
  divergenceLine: number,
  baselineSnippet: string,
  targetSnippet: string,
  startLineNumber: number
): ConsoleComparisonResult {
  return {
    status: "available",
    summaryLabel: "First console divergence found",
    detail: `Compared up to ${options.maxBytes.toLocaleString()} bytes and ${options.maxLines.toLocaleString()} lines per build.`,
    divergenceLineLabel: `First difference at line ${divergenceLine.toLocaleString()}`,
    baselineLines: toSnippetLines(baselineSnippet, startLineNumber, divergenceLine),
    targetLines: toSnippetLines(targetSnippet, startLineNumber, divergenceLine)
  };
}

function buildConsoleTooLargeResult(options: BuildCompareConsoleOptions): ConsoleComparisonResult {
  return {
    status: "tooLarge",
    summaryLabel: "Logs too large for comparison",
    detail: `Comparison stops after ${options.maxBytes.toLocaleString()} bytes or ${options.maxLines.toLocaleString()} lines per build.`,
    baselineLines: [],
    targetLines: []
  };
}

function getCommonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left.charCodeAt(index) === right.charCodeAt(index)) {
    index += 1;
  }
  return index;
}

function countLineBreaks(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}

function trimToLastLines(value: string, lineCount: number): string {
  if (lineCount <= 0 || value.length === 0) {
    return "";
  }
  let lines = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value.charCodeAt(index) === 10) {
      lines += 1;
      if (lines >= lineCount) {
        return value.slice(index + 1);
      }
    }
  }
  return value;
}

function takeFirstLines(value: string, lineCount: number): string {
  if (lineCount <= 0 || value.length === 0) {
    return "";
  }
  let lines = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      lines += 1;
      if (lines >= lineCount) {
        return value.slice(0, index + 1);
      }
    }
  }
  return value;
}

function toSnippetLines(
  value: string,
  startLineNumber: number,
  highlightLineNumber: number
): BuildCompareConsoleSnippetLine[] {
  const lines = value.replace(/\r/g, "").split("\n");
  const lastLineIsEmpty = value.endsWith("\n");
  const resolvedLines = lastLineIsEmpty ? lines.slice(0, -1) : lines;
  return resolvedLines.map((line, index) => {
    const lineNumber = startLineNumber + index;
    return {
      lineNumber,
      text: line,
      highlight: lineNumber === highlightLineNumber
    };
  });
}
