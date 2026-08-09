import { parentPort, workerData } from "node:worker_threads";
import {
  CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
  type CustomMatcherWorkerResponse,
  MAX_CUSTOM_MATCHER_DIAGNOSTICS_PER_BATCH,
  parseCustomMatcherWorkerData,
  parseCustomMatcherWorkerRequest
} from "./BuildDiagnosticCustomMatcherProtocol";
import { BuildDiagnosticLogParser } from "./BuildDiagnosticLogParser";
import type { RawBuildDiagnostic } from "./BuildDiagnosticTypes";

if (!parentPort) {
  throw new Error("Custom matcher worker requires a worker_threads parent port.");
}
const port = parentPort;

let parser: BuildDiagnosticLogParser | undefined;
let maxBatchChars = 1;
let initializationError: string | undefined;
let finished = false;

try {
  const data = parseCustomMatcherWorkerData(workerData);
  maxBatchChars = data.maxBatchChars;
  parser = new BuildDiagnosticLogParser({
    builtIns: [],
    customMatchers: data.matchers,
    maxDiagnosticsPerCall: MAX_CUSTOM_MATCHER_DIAGNOSTICS_PER_BATCH
  });
} catch (error) {
  initializationError = safeErrorMessage(error);
}

port.on("message", handleMessage);

function handleMessage(value: unknown): void {
  const requestId = readRequestId(value);
  try {
    const { id, diagnostics } = processRequest(value);
    postDiagnostics(id, diagnostics);
  } catch (error) {
    postError(requestId, error);
  }
}

function processRequest(value: unknown): { id: number; diagnostics: RawBuildDiagnostic[] } {
  const request = parseCustomMatcherWorkerRequest(value, maxBatchChars);
  const activeParser = getActiveParser();
  const diagnostics = readDiagnostics(activeParser, request);
  if (request.type === "finish") {
    finished = true;
  }
  return { id: request.id, diagnostics };
}

function getActiveParser(): BuildDiagnosticLogParser {
  if (initializationError) {
    throw new Error(initializationError);
  }
  if (!parser) {
    throw new Error("Custom matcher worker was not initialized.");
  }
  if (finished) {
    throw new Error("Custom matcher worker has already finished.");
  }
  return parser;
}

function readDiagnostics(
  activeParser: BuildDiagnosticLogParser,
  request: ReturnType<typeof parseCustomMatcherWorkerRequest>
): RawBuildDiagnostic[] {
  const diagnostics =
    request.type === "acceptChunk"
      ? activeParser.acceptChunk(request.chunk)
      : activeParser.finish();
  return diagnostics.filter((diagnostic) => diagnostic.parserId.startsWith("custom:"));
}

function postError(id: number, error: unknown): void {
  const response: CustomMatcherWorkerResponse = {
    protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
    id,
    ok: false,
    error: safeErrorMessage(error)
  };
  port.postMessage(response);
}

function postDiagnostics(id: number, diagnostics: RawBuildDiagnostic[]): void {
  if (diagnostics.length > MAX_CUSTOM_MATCHER_DIAGNOSTICS_PER_BATCH) {
    throw new Error(
      `Custom matchers exceeded ${MAX_CUSTOM_MATCHER_DIAGNOSTICS_PER_BATCH} diagnostics in one batch.`
    );
  }
  const response: CustomMatcherWorkerResponse = {
    protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
    id,
    ok: true,
    diagnostics
  };
  port.postMessage(response);
}

function readRequestId(value: unknown): number {
  const candidate = isObjectWithId(value) ? value.id : undefined;
  return isPositiveRequestId(candidate) ? candidate : 1;
}

function isObjectWithId(value: unknown): value is { id: unknown } {
  return typeof value === "object" && value !== null && "id" in value;
}

function isPositiveRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512) || "Custom matcher worker failed.";
}
