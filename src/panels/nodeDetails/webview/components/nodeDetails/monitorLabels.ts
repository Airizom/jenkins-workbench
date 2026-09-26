/**
 * Jenkins keys node monitors by Java class name (for example
 * `hudson.node_monitors.DiskSpaceMonitor`). Turn that into a readable label
 * such as "Disk space"; unrecognised shapes fall back to the raw key.
 */
export function formatMonitorLabel(key: string): string {
  const className = key.split(/[.$]/).pop()?.trim() ?? "";
  const baseName = className.replace(/Monitor$/, "");
  if (!baseName) {
    return key;
  }
  const words = baseName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/);
  return words
    .map((word, index) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) {
        return word;
      }
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase();
    })
    .join(" ");
}
