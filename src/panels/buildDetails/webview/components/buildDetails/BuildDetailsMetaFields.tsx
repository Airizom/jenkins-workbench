import { CalendarIcon, ClockIcon, UserIcon } from "../../../../shared/webview/icons";

export function BuildDetailsMetaFields({
  idSuffix = "",
  durationLabel,
  timestampLabel,
  culpritsLabel,
  className
}: {
  idSuffix?: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  className?: string;
}): JSX.Element {
  const showCulprits = culpritsLabel !== "—" && culpritsLabel !== "None";

  return (
    <div className={className}>
      <span className="inline-flex items-center gap-1" id={`detail-duration${idSuffix}`}>
        <ClockIcon className="h-3 w-3" />
        {durationLabel}
      </span>
      <span aria-hidden="true" className="opacity-30">
        |
      </span>
      <span className="inline-flex items-center gap-1" id={`detail-timestamp${idSuffix}`}>
        <CalendarIcon className="h-3 w-3" />
        {timestampLabel}
      </span>
      {showCulprits ? (
        <>
          <span aria-hidden="true" className="opacity-30">
            |
          </span>
          <span className="inline-flex items-center gap-1" id={`detail-culprits${idSuffix}`}>
            <UserIcon className="h-3 w-3" />
            {culpritsLabel}
          </span>
        </>
      ) : null}
    </div>
  );
}
