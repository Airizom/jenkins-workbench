import type * as React from "react";

import { cn } from "../../lib/utils";

type TruncatedTextProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> & {
  text: string;
};

/**
 * Single-line text that ellipsizes at its container's width and shows the
 * full value as a native `title` tooltip. The parent must constrain the width
 * (for a flex row child, the parent chain needs `min-w-0`). Pass `title` to use
 * different tooltip text.
 */
export function TruncatedText({
  text,
  title,
  className,
  ...props
}: TruncatedTextProps): React.JSX.Element {
  return (
    <span className={cn("block min-w-0 truncate", className)} title={title ?? text} {...props}>
      {text}
    </span>
  );
}
