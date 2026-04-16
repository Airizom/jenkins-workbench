import { formatError } from "../buildDetails/BuildDetailsFormatters";

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
