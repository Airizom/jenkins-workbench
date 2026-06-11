function matchesAnyParameterPattern(value: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const normalized = value.toLowerCase();
  for (const pattern of patterns) {
    if (normalized.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function shouldIncludeBuildParameter(
  name: string,
  allowList: readonly string[],
  denyList: readonly string[]
): boolean {
  if (allowList.length > 0 && !matchesAnyParameterPattern(name, allowList)) {
    return false;
  }
  if (denyList.length > 0 && matchesAnyParameterPattern(name, denyList)) {
    return false;
  }
  return true;
}

export function shouldMaskBuildParameter(name: string, maskPatterns: readonly string[]): boolean {
  return matchesAnyParameterPattern(name, maskPatterns);
}
