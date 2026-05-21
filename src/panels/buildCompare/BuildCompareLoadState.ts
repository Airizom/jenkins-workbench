import { formatError } from "../../formatters/ErrorFormatters";

export type BuildCompareOptionalResult<T> =
  | { status: "available"; value: T }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export async function loadOptionalData<T>(
  loader: () => Promise<T | undefined>
): Promise<BuildCompareOptionalResult<T>> {
  try {
    const value = await loader();
    if (typeof value === "undefined") {
      return { status: "unavailable" };
    }
    return { status: "available", value };
  } catch (error) {
    return { status: "error", message: formatError(error) };
  }
}

export function evaluateOptionalPair<T, R>(
  baseline: BuildCompareOptionalResult<T>,
  target: BuildCompareOptionalResult<T>,
  handlers: {
    onError: (messages: { baseline?: string; target?: string }) => R;
    onBothUnavailable: () => R;
    onPartialUnavailable: () => R;
    onAvailable: (baseline: T, target: T) => R;
  }
): R {
  if (baseline.status === "error" || target.status === "error") {
    return handlers.onError({
      baseline: baseline.status === "error" ? baseline.message : undefined,
      target: target.status === "error" ? target.message : undefined
    });
  }
  if (baseline.status === "unavailable" && target.status === "unavailable") {
    return handlers.onBothUnavailable();
  }
  if (baseline.status !== "available" || target.status !== "available") {
    return handlers.onPartialUnavailable();
  }
  return handlers.onAvailable(baseline.value, target.value);
}
