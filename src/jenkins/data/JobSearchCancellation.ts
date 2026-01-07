import { CancellationError } from "../errors";
import type { CancellationInput } from "./JenkinsDataTypes";

const CANCELLATION_POLL_MS = 50;

export const isCancellationRequested = (cancellation?: CancellationInput): boolean => {
  if (!cancellation) {
    return false;
  }
  if (typeof cancellation === "function") {
    return cancellation();
  }
  return cancellation.isCancellationRequested;
};

export const waitWithCancellation = async (
  delayMs: number,
  cancellation?: CancellationInput
): Promise<void> => {
  if (delayMs <= 0) {
    return;
  }
  if (!cancellation) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, delayMs);
    const interval = setInterval(() => {
      if (isCancellationRequested(cancellation)) {
        clearTimeout(timeout);
        clearInterval(interval);
        reject(new CancellationError());
      }
    }, CANCELLATION_POLL_MS);
  });
};
