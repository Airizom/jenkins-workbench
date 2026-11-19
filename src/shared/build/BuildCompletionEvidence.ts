export function isBuildQueueId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** An omitted Jenkins result does not contradict the outcome of an identified run. */
export function buildResultsCompatible(
  first: string | undefined,
  second: string | undefined
): boolean {
  return !first || !second || first === second;
}

export function requestStartedAfterNotice(
  requestOrder: number | undefined,
  noticeOrder: number | undefined
): boolean {
  return requestOrder !== undefined && noticeOrder !== undefined && requestOrder > noticeOrder;
}

export interface BuildRunExpectation {
  buildNumber: number;
  queueId?: number;
  /** The selected numbered endpoint itself supplied the queue ID. */
  requireQueueId?: boolean;
  completion?: { result?: string };
}

/** Validate a fresh Run before presenting details or logs for a one-run action. */
export function matchesBuildActionRun(
  expected: BuildRunExpectation,
  details: { number: number; queueId?: number; building?: boolean; result?: string },
  allowNewQueueId = !expected.completion
): boolean {
  if (details.number !== expected.buildNumber) return false;
  const reportedId = isBuildQueueId(details.queueId) ? details.queueId : undefined;
  const expectedId = isBuildQueueId(expected.queueId) ? expected.queueId : undefined;
  if (expected.requireQueueId && (expectedId === undefined || reportedId !== expectedId))
    return false;
  if (
    reportedId !== undefined &&
    (expectedId !== undefined || !allowNewQueueId) &&
    reportedId !== expectedId
  )
    return false;
  if (!expected.completion) return true;
  return (
    details.building === false &&
    (expected.completion.result === undefined ||
      details.result === expected.completion.result ||
      (details.result === undefined && expected.requireQueueId === true))
  );
}
