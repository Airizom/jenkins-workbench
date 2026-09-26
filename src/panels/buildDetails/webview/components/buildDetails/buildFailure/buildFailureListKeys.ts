/**
 * Builds React keys from a preferred identity, suffixing repeated identities with
 * their occurrence number so every row receives a unique key.
 */
export function createUniqueListKeys<T>(
  items: readonly T[],
  getIdentity: (item: T) => string | undefined
): string[] {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const identity = getIdentity(item) ?? "";
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return `${identity}\u0000${occurrence}`;
  });
}
