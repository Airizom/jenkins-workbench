import { useEffect, useRef } from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import type { NodeAgentLogState } from "../../../shared/NodeAgentLogContracts";

export function NodeAgentLogSection({
  state,
  onFollow,
  onRefresh,
  onCopy
}: {
  state: NodeAgentLogState;
  onFollow?: () => void;
  onRefresh?: () => void;
  onCopy?: () => void;
}): React.JSX.Element {
  const log = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (state.text.length > 0 && state.following && log.current) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [state.text, state.following]);
  return (
    <section aria-label="Agent log" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onFollow}>
          {state.following ? "Pause" : "Follow"}
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={state.loading}>
          Refresh log
        </Button>
        <Button variant="outline" size="sm" onClick={onCopy} disabled={!state.text}>
          Copy log
        </Button>
        <span className="text-xs text-muted-foreground" role="status">
          {state.loading
            ? "Loading…"
            : state.following
              ? state.catchingUp
                ? "Catching up with agent output…"
                : "Following recent output"
              : "Paused"}
        </span>
      </div>
      {state.error ? (
        <div role="alert" className="text-xs text-failure">
          Unable to load agent log: {state.error}{" "}
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Retry
          </Button>
        </div>
      ) : null}
      {state.omitted ? (
        <p className="text-xs text-muted-foreground">
          Older log output omitted. Copy includes the displayed output.
        </p>
      ) : null}
      <textarea
        readOnly
        ref={log}
        aria-label="Agent log output"
        aria-busy={state.loading}
        className="h-[55vh] min-h-48 w-full resize-y overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap"
        value={state.text}
        placeholder={state.loading ? "Loading agent log…" : "No agent log output available."}
        spellCheck={false}
      />
    </section>
  );
}
