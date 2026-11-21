// Placeholder labels the backend uses when a value is missing or empty.
const EMPTY_META_LABELS = new Set(["", "—", "None", "Unknown"]);

export function hasMetaValue(label: string | undefined): label is string {
  return label !== undefined && !EMPTY_META_LABELS.has(label.trim());
}
