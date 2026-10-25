export function formatParameterDefaultValue(
  value: unknown
): string | number | boolean | string[] | undefined {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object":
      if (value === null) {
        return undefined;
      }
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry));
      }
      return JSON.stringify(value);
  }
  return undefined;
}
