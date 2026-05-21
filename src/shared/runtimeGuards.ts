export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function hasMessageType<TType extends string>(
  message: unknown,
  type: TType
): message is Record<string, unknown> & { type: TType } {
  return asRecord(message)?.type === type;
}

export interface OpenExternalMessage {
  type: "openExternal";
  url: string;
}

export function isOpenExternalMessage(message: unknown): message is OpenExternalMessage {
  return hasMessageType(message, "openExternal") && typeof message.url === "string";
}

export interface SetLoadingOutgoingMessage {
  type: "setLoading";
  value: boolean;
}

export function parseSetLoadingOutgoingMessage(
  record: Record<string, unknown>
): SetLoadingOutgoingMessage | undefined {
  if (record.type !== "setLoading") {
    return undefined;
  }
  return {
    type: "setLoading",
    value: typeof record.value === "boolean" ? record.value : Boolean(record.value)
  };
}
