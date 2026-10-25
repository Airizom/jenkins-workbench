import * as fs from "node:fs";
import { finished, pipeline } from "node:stream/promises";
import { BuildActionError } from "../jenkins/errors";
import { JenkinsConsoleNoteFilter } from "../jenkins/JenkinsConsoleNotes";
import type { JenkinsConsoleTextClient } from "../jenkins/JenkinsConsoleTextClient";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../jenkins/types";
import { writeViaTemporaryFile } from "./TemporaryFileWriter";

export interface BuildConsoleFilesystem {
  createWriteStream(
    targetPath: string,
    options?: { encoding?: BufferEncoding }
  ): NodeJS.WritableStream;
  writeFile(targetPath: string, data: string, encoding: BufferEncoding): Promise<void>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  delete(targetPath: string): Promise<void>;
}

export function createNodeBuildConsoleFilesystem(): BuildConsoleFilesystem {
  return {
    createWriteStream: (targetPath, options) =>
      fs.createWriteStream(targetPath, { ...options, flags: "wx" }),
    writeFile: (targetPath, data, encoding) => fs.promises.writeFile(targetPath, data, encoding),
    rename: (sourcePath, targetPath) => fs.promises.rename(sourcePath, targetPath),
    delete: (targetPath) => fs.promises.unlink(targetPath)
  };
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
    private readonly client: JenkinsConsoleTextClient,
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
    return writeViaTemporaryFile(options.targetPath, {
      write: async (temporaryPath) => {
        try {
          return await this.writeConsoleProgressive(
            temporaryPath,
            options.environment,
            options.buildUrl
          );
        } catch (error) {
          if (!this.shouldFallbackToSnapshot(error)) {
            throw error;
          }
          return this.writeConsoleSnapshot(temporaryPath, options.environment, options.buildUrl);
        }
      },
      rename: (temporaryPath) => this.filesystem.rename(temporaryPath, options.targetPath),
      delete: (temporaryPath) => this.filesystem.delete(temporaryPath)
    });
  }

  private async writeConsoleProgressive(
    targetPath: string,
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<BuildConsoleExportResult> {
    const writeStream = this.filesystem.createWriteStream(targetPath, { encoding: "utf8" });
    const state = { truncated: false };
    try {
      await pipeline(this.getProgressiveConsoleChunks(environment, buildUrl, state), writeStream);
    } catch (error) {
      // The pipeline can reject before the file stream finishes opening and closing.
      await finished(writeStream, { cleanup: true }).catch(() => {});
      throw error;
    }
    return { mode: "progressive", truncated: state.truncated };
  }

  private async *getProgressiveConsoleChunks(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    state: { truncated: boolean }
  ): AsyncGenerator<string> {
    let start = 0;
    let emptyAttempts = 0;
    const noteFilter = new JenkinsConsoleNoteFilter();
    while (true) {
      const response = await this.client.getConsoleTextProgressive(environment, buildUrl, start);
      const nextStart = Math.max(start, response.textSize);
      if (response.moreData && nextStart === start) {
        emptyAttempts += 1;
        if (emptyAttempts > this.progressiveEmptyRetries) {
          state.truncated = true;
          break;
        }
        await this.delay(this.progressiveEmptyDelayMs);
        continue;
      }
      if (response.text.length > 0) {
        const text = noteFilter.append(response.text);
        if (text) {
          yield text;
        }
        emptyAttempts = 0;
      }
      if (!response.moreData) {
        break;
      }
      start = nextStart;
    }
    const remainder = noteFilter.finish();
    if (remainder) {
      yield remainder;
    }
  }

  private async writeConsoleSnapshot(
    targetPath: string,
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<BuildConsoleExportResult> {
    let snapshot: { text: string; truncated: boolean };
    let mode: "full" | "tail";
    try {
      snapshot = await this.client.getConsoleText(environment, buildUrl);
      mode = "full";
    } catch {
      snapshot = await this.client.getConsoleTextTail(environment, buildUrl, this.maxConsoleChars);
      mode = "tail";
    }
    await this.filesystem.writeFile(targetPath, snapshot.text, "utf8");
    return { mode, truncated: snapshot.truncated };
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
