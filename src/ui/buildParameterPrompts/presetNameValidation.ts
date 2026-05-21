export function validatePresetName(value: string): string | undefined {
  if (!value.trim()) {
    return "Preset name is required.";
  }
  return undefined;
}
