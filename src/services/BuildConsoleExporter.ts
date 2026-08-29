import * as fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { BuildActionError } from "../jenkins/errors";
import type { JenkinsConsoleTextClient } from "../jenkins/JenkinsConsoleTextClient";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../jenkins/types";

export interface BuildConsoleFilesystem {
  createWriteStream(
    targetPath: string,
    options?: { encoding?: BufferEncoding }
  ): NodeJS.WritableStream;
  writeFile(targetPath: string, data: string, encoding: BufferEncoding): Promise<void>;
}

export function createNodeBuildConsoleFilesystem(): BuildConsoleFilesystem {
  return {
    createWriteStream: (targetPath, options) => fs.createWriteStream(targetPath, options),
    writeFile: (targetPath, data, encoding) => fs.promises.writeFile(targetPath, data, encoding)
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
    const state = { truncated: false };
    await pipeline(this.getProgressiveConsoleChunks(environment, buildUrl, state), writeStream);
    return { mode: "progressive", truncated: state.truncated };
  }

  private async *getProgressiveConsoleChunks(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    state: { truncated: boolean }
  ): AsyncGenerator<string> {
    let start = 0;
    let emptyAttempts = 0;
    while (true) {
      const response = await this.client.getConsoleTextProgressive(environment, buildUrl, start);
      const nextStart = Math.max(start, response.textSize);
      if (response.moreData && nextStart === start) {
        emptyAttempts += 1;
        if (emptyAttempts > this.progressiveEmptyRetries) {
          state.truncated = true;
          return;
        }
        await this.delay(this.progressiveEmptyDelayMs);
        continue;
      }
      if (response.text.length > 0) {
        yield response.text;
        emptyAttempts = 0;
      }
      if (!response.moreData) {
        return;
      }
      start = nextStart;
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
