export type CompareDiffChangeType = "added" | "removed" | "changed" | "matched";

/** Diff badges use SCM decoration colors (styles.css), not pass/fail tones. */
const CHANGE_TYPE_BADGES: Record<
  Exclude<CompareDiffChangeType, "matched">,
  { label: string; glyph: string }
> = {
  added: { label: "Added", glyph: "+" },
  removed: { label: "Removed", glyph: "−" },
  changed: { label: "Changed", glyph: "~" }
};

export function CompareChangeBadge({
  changeType,
  label
}: {
  changeType?: CompareDiffChangeType;
  /** Overrides the default label, e.g. "New test". */
  label?: string;
}) {
  const badge = changeType && changeType !== "matched" ? CHANGE_TYPE_BADGES[changeType] : undefined;
  if (!badge) {
    return null;
  }
  return (
    <span
      data-change={changeType}
      className="bc-diff-badge inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-caption font-medium leading-4 whitespace-nowrap"
    >
      <span aria-hidden="true">{badge.glyph}</span>
      {label ?? badge.label}
    </span>
  );
}
