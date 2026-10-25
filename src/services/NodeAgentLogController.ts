import { formatActionError } from "../formatters/ErrorFormatters";
import type { NodeAgentLogState } from "../panels/nodeDetails/shared/NodeAgentLogContracts";
import { emptyNodeAgentLogState } from "../panels/nodeDetails/shared/NodeAgentLogContracts";

const NODE_AGENT_LOG_INTERVAL_MS = 3_000;
export const NODE_AGENT_LOG_BUFFER_BYTES = 256 * 1024;

type LogReader = (options: { start?: number; signal: AbortSignal }) => Promise<{
  text: string;
  nextStart: number;
  reset: boolean;
  truncated: boolean;
  catchingUp?: boolean;
}>;

/** Owns one panel's log buffer; no timer or response may outlive its target. */
export class NodeAgentLogController {
  private state = emptyNodeAgentLogState();
  private reader?: LogReader;
  private visible = false;
  private active = false;
  private disposed = false;
  private nextStart?: number;
  private loaded = false;
  private generation = 0;
  private request?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly publish: (state: NodeAgentLogState) => void) {}

  reset(reader: LogReader | undefined, following = true): void {
    this.cancel();
    this.reader = reader;
    this.nextStart = undefined;
    this.loaded = false;
    this.active = false;
    this.state = emptyNodeAgentLogState(following);
    this.emit();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) {
      return;
    }
    this.visible = visible;
    this.updateActivity();
  }

  setActive(active: boolean): void {
    if (this.active === active) {
      return;
    }
    this.active = active;
    this.updateActivity();
  }

  setFollowing(following: boolean): void {
    if (this.state.following === following) {
      return;
    }
    this.state = { ...this.state, following, error: undefined };
    this.emit();
    if (following) {
      this.updateActivity();
    } else {
      this.cancel();
    }
  }

  refresh(): void {
    this.cancel();
    this.nextStart = undefined;
    this.state = { ...this.state, error: undefined };
    if (this.canRead) {
      void this.read(true);
    }
  }

  get text(): string {
    return this.state.text;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.reader = undefined;
    this.state = emptyNodeAgentLogState();
  }

  private get canRead(): boolean {
    return !this.disposed && this.active && this.visible && this.reader !== undefined;
  }

  private updateActivity(): void {
    this.cancel();
    if (this.canRead && (!this.loaded || this.state.following)) {
      void this.read();
    }
  }

  private cancel(): void {
    this.generation += 1;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.request?.abort();
    this.request = undefined;
    if (this.state.loading) {
      this.state = { ...this.state, loading: false };
      this.emit();
    }
  }

  private applyResult(result: Awaited<ReturnType<LogReader>>, replace: boolean): void {
    const bounded = boundLogText(
      replace || result.reset || this.nextStart === undefined
        ? result.text
        : this.state.text + result.text
    );
    this.nextStart = result.nextStart;
    this.loaded = true;
    this.state = {
      ...this.state,
      text: bounded.text,
      catchingUp: result.catchingUp === true,
      omitted:
        (replace || result.reset ? false : this.state.omitted) ||
        result.truncated ||
        bounded.omitted,
      loading: false
    };
    this.emit();
  }

  private async read(replace = false): Promise<void> {
    if (!this.canRead || this.request || !this.reader) {
      return;
    }
    const generation = this.generation;
    const abort = new AbortController();
    this.request = abort;
    this.state = { ...this.state, loading: true, error: undefined };
    this.emit();
    try {
      const result = await this.reader({ start: this.nextStart, signal: abort.signal });
      if (generation !== this.generation || abort.signal.aborted || this.disposed) {
        return;
      }
      this.applyResult(result, replace);
    } catch (error) {
      if (generation !== this.generation || abort.signal.aborted || this.disposed) {
        return;
      }
      this.loaded = true;
      this.state = {
        ...this.state,
        loading: false,
        following: false,
        error: formatActionError(error)
      };
      this.emit();
    } finally {
      if (generation === this.generation && this.request === abort) {
        this.request = undefined;
        if (this.canRead && this.state.following) {
          this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.read();
          }, NODE_AGENT_LOG_INTERVAL_MS);
        }
      }
    }
  }

  private emit(): void {
    if (!this.disposed) {
      this.publish({ ...this.state });
    }
  }
}

export function boundLogText(text: string): { text: string; omitted: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= NODE_AGENT_LOG_BUFFER_BYTES) {
    return { text, omitted: false };
  }
  let start = bytes.length - NODE_AGENT_LOG_BUFFER_BYTES;
  // Start at a complete code point when the bounded tail lands inside UTF-8.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return { text: bytes.subarray(start).toString("utf8"), omitted: true };
}
