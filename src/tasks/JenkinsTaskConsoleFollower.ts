import { JenkinsConsoleNoteFilter } from "../jenkins/JenkinsConsoleNotes";
import type {
  JenkinsTaskRunnerBackend,
  JenkinsTaskRunnerOutput,
  JenkinsTaskRunRequest,
  RequiredJenkinsTaskRunnerOptions
} from "./JenkinsTaskRunnerContracts";
import {
  errorMessage,
  formatByteLimit,
  isProgressiveConsoleUnsupported,
  RunnerFailure,
  TaskCanceledError
} from "./JenkinsTaskRunnerSupport";

const MAX_FINAL_CONSOLE_STABLE_MORE_DATA_POLLS = 3;

interface ConsolePollResult {
  progressive: boolean;
  offset: number;
  errors: number;
  pollImmediately: boolean;
  moreData: boolean;
}

export interface JenkinsTaskPollingControl {
  isCanceled(): boolean;
  throwIfCanceled(): void;
  waitForNextPoll(consecutiveErrors?: number): Promise<void>;
}

export class ConsoleLineWriter {
  private pendingCarriageReturn = false;
  private readonly notes = new JenkinsConsoleNoteFilter();

  constructor(private readonly write: (text: string) => void) {}

  append(text: string): void {
    const clean = this.notes.append(text);
    let value = this.pendingCarriageReturn ? `\r${clean}` : clean;
    this.pendingCarriageReturn = false;
    if (value.endsWith("\r")) {
      value = value.slice(0, -1);
      this.pendingCarriageReturn = true;
    }
    if (value.length > 0) {
      this.write(value.replace(/\r\n?/g, "\n"));
    }
  }

  flush(): void {
    const remainder = this.notes.finish();
    if (remainder) {
      this.write((this.pendingCarriageReturn ? "\n" : "") + remainder);
      this.pendingCarriageReturn = false;
    }
    if (this.pendingCarriageReturn) {
      this.write("\n");
      this.pendingCarriageReturn = false;
    }
  }
}

export class JenkinsTaskConsoleFollower {
  constructor(
    private readonly backend: JenkinsTaskRunnerBackend,
    private readonly options: RequiredJenkinsTaskRunnerOptions,
    private readonly output: JenkinsTaskRunnerOutput,
    private readonly control: JenkinsTaskPollingControl
  ) {}

  async poll(
    request: JenkinsTaskRunRequest,
    buildUrl: string,
    writer: ConsoleLineWriter,
    progressive: boolean,
    offset: number,
    errors: number
  ): Promise<ConsolePollResult> {
    if (progressive) {
      try {
        const result = await this.backend.getConsoleTextProgressive(
          request.environment,
          buildUrl,
          offset,
          this.options.maxConsoleChunkBytes
        );
        this.control.throwIfCanceled();
        if (!Number.isSafeInteger(result.textSize) || result.textSize < offset) {
          throw new Error("Jenkins returned an invalid progressive console offset.");
        }
        writer.append(result.text);
        return {
          progressive: true,
          offset: result.textSize,
          errors: 0,
          // Only bypass the normal delay when the bounded read filled its byte
          // budget and advanced, indicating buffered data is still waiting.
          pollImmediately:
            result.moreData &&
            result.textSize > offset &&
            result.bytesRead >= this.options.maxConsoleChunkBytes,
          moreData: result.moreData
        };
      } catch (error) {
        if (error instanceof TaskCanceledError || this.control.isCanceled()) {
          throw new TaskCanceledError();
        }
        if (isProgressiveConsoleUnsupported(error)) {
          this.output.writeStatus(
            "Progressive console is unsupported; switching to full console polling."
          );
          return this.pollFull(request, buildUrl, writer, offset, 0);
        }
        const nextErrors = errors + 1;
        if (nextErrors < this.options.maxConsecutiveErrors) {
          this.output.writeStatus(
            `Progressive console unavailable; retrying (${nextErrors}/${this.options.maxConsecutiveErrors}).`
          );
          return {
            progressive: true,
            offset,
            errors: nextErrors,
            pollImmediately: false,
            moreData: true
          };
        }
        this.output.writeStatus(
          "Progressive console is unavailable; switching to full console polling."
        );
        return this.pollFull(request, buildUrl, writer, offset, 0);
      }
    }
    return this.pollFull(request, buildUrl, writer, offset, errors);
  }

  async drain(
    request: JenkinsTaskRunRequest,
    buildUrl: string,
    writer: ConsoleLineWriter,
    progressive: boolean,
    offset: number,
    errors: number
  ): Promise<void> {
    let currentProgressive = progressive;
    let currentOffset = offset;
    let currentErrors = errors;
    let stableMoreDataPolls = 0;
    while (true) {
      this.control.throwIfCanceled();
      const previousOffset = currentOffset;
      const result = await this.poll(
        request,
        buildUrl,
        writer,
        currentProgressive,
        currentOffset,
        currentErrors
      );
      this.control.throwIfCanceled();
      currentProgressive = result.progressive;
      currentOffset = result.offset;
      currentErrors = result.errors;
      if (result.errors > 0) {
        await this.control.waitForNextPoll(result.errors);
        continue;
      }
      if (result.offset > previousOffset) {
        stableMoreDataPolls = 0;
        if (!result.pollImmediately) {
          await this.control.waitForNextPoll();
        }
        continue;
      }
      if (!result.moreData) {
        return;
      }
      stableMoreDataPolls++;
      if (stableMoreDataPolls >= MAX_FINAL_CONSOLE_STABLE_MORE_DATA_POLLS) {
        this.output.writeStatus(
          "Jenkins continued to report more console data at a stable offset; ending the final console drain."
        );
        return;
      }
      await this.control.waitForNextPoll();
    }
  }

  private async pollFull(
    request: JenkinsTaskRunRequest,
    buildUrl: string,
    writer: ConsoleLineWriter,
    offset: number,
    errors: number
  ): Promise<ConsolePollResult> {
    try {
      const result = await this.backend.getConsoleTextHead(
        request.environment,
        buildUrl,
        this.options.maxFullConsoleBytes
      );
      this.control.throwIfCanceled();
      if (result.truncated) {
        throw new RunnerFailure(
          `Jenkins console output exceeds the ${formatByteLimit(this.options.maxFullConsoleBytes)} fallback safety limit.`
        );
      }
      const bytes = Buffer.from(result.text, "utf8");
      if (bytes.byteLength < offset) {
        throw new Error("Jenkins console output became shorter while polling.");
      }
      if (bytes.byteLength > offset) {
        writer.append(bytes.subarray(offset).toString("utf8"));
      }
      return {
        progressive: false,
        offset: bytes.byteLength,
        errors: 0,
        pollImmediately: false,
        moreData: false
      };
    } catch (error) {
      if (error instanceof TaskCanceledError || this.control.isCanceled()) {
        throw new TaskCanceledError();
      }
      if (error instanceof RunnerFailure) {
        throw error;
      }
      const nextErrors = errors + 1;
      if (nextErrors >= this.options.maxConsecutiveErrors) {
        throw new RunnerFailure(
          `Unable to stream Jenkins console output after ${nextErrors} consecutive errors: ${errorMessage(error)}`
        );
      }
      this.output.writeStatus(
        `Console output unavailable; retrying (${nextErrors}/${this.options.maxConsecutiveErrors}).`
      );
      return {
        progressive: false,
        offset,
        errors: nextErrors,
        pollImmediately: false,
        moreData: true
      };
    }
  }
}
