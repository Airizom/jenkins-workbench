import type { IncomingHttpHeaders } from "node:http";
import type { JenkinsActionErrorCode } from "./data/JenkinsDataTypes";

export class JenkinsRequestError extends Error {
  readonly code?: string;
  readonly statusCode?: number;
  readonly responseText?: string;
  readonly responseHeaders?: IncomingHttpHeaders;

  constructor(
    message: string,
    statusCode?: number,
    responseText?: string,
    responseHeaders?: IncomingHttpHeaders,
    code?: string
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.responseText = responseText;
    this.responseHeaders = responseHeaders;
  }
}

/** Jenkins refused to create an item because the parent already holds one with that name. */
export class JenkinsDuplicateItemError extends JenkinsRequestError {}

export class JenkinsMaxBytesError extends JenkinsRequestError {
  readonly maxBytes: number;

  constructor(maxBytes: number, statusCode?: number) {
    super(`Response exceeded max download size (${maxBytes} bytes).`, statusCode);
    this.maxBytes = maxBytes;
  }
}

export class JenkinsActionError extends Error {
  readonly code: JenkinsActionErrorCode;
  readonly statusCode?: number;

  constructor(message: string, code: JenkinsActionErrorCode, statusCode?: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class BuildActionError extends JenkinsActionError {}
export class JobManagementActionError extends JenkinsActionError {}

export class CancellationError extends Error {
  constructor() {
    super("Operation cancelled.");
  }
}
