import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { ExecutorsTableCard } from "./ExecutorsTableCard";

type NodeDetailsExecutorsSectionProps = {
  executors: NodeDetailsState["executors"];
  oneOffExecutors: NodeDetailsState["oneOffExecutors"];
  onOpenExternal: (url: string) => void;
};

export function NodeDetailsExecutorsSection({
  executors,
  oneOffExecutors,
  onOpenExternal
}: NodeDetailsExecutorsSectionProps): JSX.Element {
  return (
    <>
      <ExecutorsTableCard title="Executors" entries={executors} onOpenExternal={onOpenExternal} />
      {oneOffExecutors.length > 0 ? (
        <ExecutorsTableCard
          title="One-off Executors"
          entries={oneOffExecutors}
          onOpenExternal={onOpenExternal}
        />
      ) : null}
    </>
  );
}
