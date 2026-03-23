export function formatParameterDefaultValue(
  value: unknown
): string | number | boolean | string[] | undefined {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "undefined":
      return undefined;
    case "bigint":
      return value.toString();
    case "symbol":
      return value.description ?? value.toString();
    case "function":
      return value.name ? `[function ${value.name}]` : "[function]";
    case "object":
      if (value === null) {
        return undefined;
      }
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry));
      }
      try {
        return JSON.stringify(value);
      } catch {
        return "[object]";
      }
    default:
      return undefined;
  }
}
