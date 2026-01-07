import type { BuildActionErrorCode } from "./data/JenkinsDataTypes";

export class JenkinsRequestError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class BuildActionError extends Error {
  readonly code: BuildActionErrorCode;
  readonly statusCode?: number;

  constructor(message: string, code: BuildActionErrorCode, statusCode?: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class CancellationError extends Error {
  constructor() {
    super("Operation cancelled.");
  }
}
