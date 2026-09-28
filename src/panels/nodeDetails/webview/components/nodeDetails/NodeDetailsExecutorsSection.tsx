import type * as React from "react";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { ExecutorsTableCard } from "./ExecutorsTableCard";

type NodeDetailsExecutorsSectionProps = {
  executors: NodeDetailsState["executors"];
  oneOffExecutors: NodeDetailsState["oneOffExecutors"];
  isOffline: boolean;
  onOpenExternal: (url: string) => void;
};
export function NodeDetailsExecutorsSection({
  executors,
  oneOffExecutors,
  isOffline,
  onOpenExternal
}: NodeDetailsExecutorsSectionProps): React.JSX.Element {
  return (
    <>
      <ExecutorsTableCard
        title="Executors"
        entries={executors}
        isOffline={isOffline}
        onOpenExternal={onOpenExternal}
      />
      {oneOffExecutors.length > 0 ? (
        <ExecutorsTableCard
          title="One-off Executors"
          entries={oneOffExecutors}
          isOffline={isOffline}
          onOpenExternal={onOpenExternal}
        />
      ) : null}
    </>
  );
}
