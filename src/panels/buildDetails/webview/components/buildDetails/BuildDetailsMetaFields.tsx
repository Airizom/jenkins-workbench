import * as React from "react";
import { CalendarIcon, ClockIcon, UserIcon } from "../../../../shared/webview/icons";

// Placeholder labels the backend uses when a value is missing or empty.
const EMPTY_META_LABELS = new Set(["", "—", "None", "Unknown"]);

export function hasMetaValue(label: string | undefined): label is string {
  return label !== undefined && !EMPTY_META_LABELS.has(label.trim());
}

export function BuildDetailsMetaFields({
  idSuffix = "",
  durationLabel,
  timestampLabel,
  culpritsLabel,
  className,
  showSeparators = true
}: {
  idSuffix?: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  className?: string;
  showSeparators?: boolean;
}): React.JSX.Element {
  // Duration and timestamp render unless blank (their "Unknown" is informative
  // while loading); culprits are omitted when there are none. Separators only
  // sit between rendered items.
  const items = [
    { id: "duration", icon: ClockIcon, label: durationLabel, show: durationLabel.trim() !== "" },
    {
      id: "timestamp",
      icon: CalendarIcon,
      label: timestampLabel,
      show: timestampLabel.trim() !== ""
    },
    { id: "culprits", icon: UserIcon, label: culpritsLabel, show: hasMetaValue(culpritsLabel) }
  ].filter((item) => item.show);

  return (
    <div className={className}>
      {items.map(({ id, icon: Icon, label }, index) => (
        <React.Fragment key={id}>
          {showSeparators && index > 0 ? (
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1" id={`detail-${id}${idSuffix}`}>
            <Icon className="h-3 w-3" />
            {label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
