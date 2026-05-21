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

export function isOpenExternalMessage(
  message: unknown
): message is { type: "openExternal"; url: string } {
  return hasMessageType(message, "openExternal") && typeof message.url === "string";
}
