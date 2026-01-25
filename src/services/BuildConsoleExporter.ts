import * as fs from "node:fs";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { BuildActionError } from "../jenkins/errors";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleText
} from "../jenkins/types";

export interface BuildConsoleWriteStream {
  destroyed: boolean;
  once(event: "open", listener: () => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "drain", listener: () => void): this;
  once(event: "close", listener: () => void): this;
  write(chunk: string): boolean;
  end(cb?: () => void): this;
  end(data: string | Uint8Array, cb?: () => void): this;
  end(str: string, encoding?: BufferEncoding, cb?: () => void): this;
  destroy(error?: Error): this;
}

export interface BuildConsoleFilesystem {
  createWriteStream(
    targetPath: string,
    options?: { encoding?: BufferEncoding }
  ): BuildConsoleWriteStream;
  writeFile(targetPath: string, data: string, encoding: BufferEncoding): Promise<void>;
}

export function createNodeBuildConsoleFilesystem(): BuildConsoleFilesystem {
  return {
    createWriteStream: (targetPath, options) => fs.createWriteStream(targetPath, options),
    writeFile: (targetPath, data, encoding) => fs.promises.writeFile(targetPath, data, encoding)
  };
}

export interface BuildConsoleExportClient {
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

export type BuildConsoleExportMode = "progressive" | "full" | "tail";

export type BuildConsoleExportResult = {
  mode: BuildConsoleExportMode;
  truncated: boolean;
};

export interface BuildConsoleExporterOptions {
  maxConsoleChars: number;
  progressiveEmptyRetries?: number;
  progressiveEmptyDelayMs?: number;
}

const DEFAULT_PROGRESSIVE_EMPTY_RETRIES = 3;
const DEFAULT_PROGRESSIVE_EMPTY_DELAY_MS = 500;

export class BuildConsoleExporter {
  private readonly maxConsoleChars: number;
  private readonly progressiveEmptyRetries: number;
  private readonly progressiveEmptyDelayMs: number;

  constructor(
    private readonly client: BuildConsoleExportClient,
    private readonly filesystem: BuildConsoleFilesystem,
    options: BuildConsoleExporterOptions
  ) {
    this.maxConsoleChars = options.maxConsoleChars;
    this.progressiveEmptyRetries =
      options.progressiveEmptyRetries ?? DEFAULT_PROGRESSIVE_EMPTY_RETRIES;
    this.progressiveEmptyDelayMs =
      options.progressiveEmptyDelayMs ?? DEFAULT_PROGRESSIVE_EMPTY_DELAY_MS;
  }

  getDefaultFileName(details?: JenkinsBuildDetails): string {
    const baseName = details?.fullDisplayName ?? details?.displayName ?? "jenkins-console";
    const safeName = sanitizeFileName(baseName);
    const lowerName = safeName.toLowerCase();
    if (lowerName.endsWith(".log") || lowerName.endsWith(".txt")) {
      return safeName;
    }
    return `${safeName}.log`;
  }

  async exportToFile(options: {
    environment: JenkinsEnvironmentRef;
    buildUrl: string;
    targetPath: string;
  }): Promise<BuildConsoleExportResult> {
    try {
      return await this.writeConsoleProgressive(
        options.targetPath,
        options.environment,
        options.buildUrl
      );
    } catch (error) {
      if (!this.shouldFallbackToSnapshot(error)) {
        throw error;
      }
    }
    return this.writeConsoleSnapshot(options.targetPath, options.environment, options.buildUrl);
  }

  private async writeConsoleProgressive(
    targetPath: string,
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<BuildConsoleExportResult> {
    const writeStream = this.filesystem.createWriteStream(targetPath, { encoding: "utf8" });
    await this.waitForWriteStreamOpen(writeStream);
    try {
      let start = 0;
      let emptyAttempts = 0;
      let truncated = false;
      while (true) {
        const response = await this.client.getConsoleTextProgressive(environment, buildUrl, start);
        if (response.text.length > 0) {
          await this.writeStreamChunk(writeStream, response.text);
          emptyAttempts = 0;
        }
        const nextStart = Math.max(start, response.textSize);
        if (!response.moreData) {
          break;
        }
        if (response.text.length === 0 && nextStart === start) {
          emptyAttempts += 1;
          if (emptyAttempts > this.progressiveEmptyRetries) {
            truncated = true;
            break;
          }
          await this.delay(this.progressiveEmptyDelayMs);
          continue;
        }
        start = nextStart;
      }
      await this.finalizeWriteStream(writeStream);
      return { mode: "progressive", truncated };
    } catch (error) {
      await this.destroyWriteStream(writeStream);
      throw error;
    }
  }

  private async writeConsoleSnapshot(
    targetPath: string,
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<BuildConsoleExportResult> {
    try {
      const consoleText = await this.client.getConsoleText(environment, buildUrl);
      await this.filesystem.writeFile(targetPath, consoleText.text, "utf8");
      return { mode: "full", truncated: consoleText.truncated };
    } catch {
      const tail = await this.client.getConsoleTextTail(
        environment,
        buildUrl,
        this.maxConsoleChars
      );
      await this.filesystem.writeFile(targetPath, tail.text, "utf8");
      return { mode: "tail", truncated: tail.truncated };
    }
  }

  private async waitForWriteStreamOpen(writeStream: BuildConsoleWriteStream): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      writeStream.once("open", () => resolve());
      writeStream.once("error", reject);
    });
  }

  private async writeStreamChunk(
    writeStream: BuildConsoleWriteStream,
    chunk: string
  ): Promise<void> {
    if (writeStream.write(chunk)) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.once("drain", () => resolve());
      writeStream.once("error", reject);
    });
  }

  private async finalizeWriteStream(writeStream: BuildConsoleWriteStream): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      writeStream.once("error", reject);
      writeStream.end(() => resolve());
    });
  }

  private async destroyWriteStream(writeStream: BuildConsoleWriteStream): Promise<void> {
    if (writeStream.destroyed) {
      return;
    }
    await new Promise<void>((resolve) => {
      writeStream.once("close", () => resolve());
      writeStream.destroy();
    });
  }

  private async delay(durationMs: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  }

  private shouldFallbackToSnapshot(error: unknown): boolean {
    if (error instanceof BuildActionError) {
      return error.code === "not_found";
    }
    return false;
  }
}

function sanitizeFileName(value: string): string {
  const sanitized = value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
  return sanitized.length > 0 ? sanitized : "jenkins-console";
}
