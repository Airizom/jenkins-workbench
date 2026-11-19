import type { JenkinsBuildDetails } from "../../jenkins/types";
import { isBuildQueueId } from "../../shared/build/BuildCompletionEvidence";
import { resolveDisplayedRun } from "./BuildDetailsRunIdentity";
import {
  type ConsoleSnapshotResult,
  ConsoleStreamManager,
  type ConsoleStreamManagerOptions
} from "./ConsoleStreamManager";

interface ConsoleRun {
  url?: string;
  number?: number;
  queueId?: number;
  result?: string;
  building?: boolean;
  lastGoodSnapshot?: ConsoleSnapshotResult;
}

interface ConsoleSession {
  run: ConsoleRun;
  stream?: ConsoleStreamManager;
  seed?: Promise<ConsoleSnapshotResult>;
  seeding: boolean;
  retired: Promise<void>;
  retire(): void;
}

/** Keep the tail and both progressive cursors together. An old read can only mutate its old stream. */
export class BuildDetailsRunConsole {
  private current: ConsoleSession;
  private disposed = false;

  constructor(private readonly options: ConsoleStreamManagerOptions) {
    this.current = this.createSession({ url: options.buildUrl });
  }

  get url(): string | undefined {
    return this.current.run.url;
  }

  get stream(): ConsoleStreamManager | undefined {
    return this.current.seeding ? undefined : this.current.stream;
  }

  select(
    details: JenkinsBuildDetails | undefined,
    catchUpAtCompletion: boolean
  ): "replacement" | "terminal" | undefined {
    if (!details || this.disposed) return undefined;
    const { environment, buildUrl } = this.options;
    const run: ConsoleRun = {
      url: resolveDisplayedRun(environment, buildUrl, details)?.buildUrl,
      number: details.number,
      queueId: isBuildQueueId(details.queueId) ? details.queueId : undefined,
      building: details.building,
      result: details.result
    };
    const previous = this.current.run;
    if (
      previous.url === run.url &&
      previous.number === run.number &&
      !(previous.building === false && run.building === true) &&
      (run.queueId === undefined || previous.queueId === run.queueId) &&
      (!previous.result || !run.result || previous.result === run.result)
    ) {
      const needsFinalTail =
        catchUpAtCompletion &&
        previous.building !== false &&
        run.building === false &&
        this.current.seed;
      previous.result ??= run.result;
      previous.building = run.building ?? previous.building;
      if (needsFinalTail) {
        // The initial tail or an in-flight progressive read can predate the final bytes.
        // The next presentation must seed both cursors from this confirmed terminal run.
        this.replace(previous);
        return "terminal";
      }
      return undefined;
    }
    this.replace(run);
    return "replacement";
  }

  async withSnapshot(
    use: (snapshot: ConsoleSnapshotResult) => void,
    refresh = false
  ): Promise<void> {
    // Replacing a snapshot also replaces both cursors, even at the same numbered URL.
    const loadingFinalTail = this.current.run.building === false && this.current.seeding;
    if (refresh && !this.disposed && !loadingFinalTail) this.replace(this.current.run);
    while (!this.disposed) {
      const session = this.current;
      const snapshot = await Promise.race([this.seed(session), session.retired]);
      if (session === this.current && !this.disposed && snapshot) {
        try {
          // Keep the bounded fallback on the run, not the numbered URL: a recycled
          // endpoint must never inherit the earlier run's bytes or HTML.
          if (snapshot.consoleTextResult) session.run.lastGoodSnapshot = snapshot;
          use(
            snapshot.consoleError && session.run.lastGoodSnapshot
              ? { ...session.run.lastGoodSnapshot, consoleError: snapshot.consoleError }
              : snapshot
          );
        } finally {
          session.seeding = false;
        }
        return;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.current.retire();
  }

  private seed(session: ConsoleSession): Promise<ConsoleSnapshotResult> {
    if (!session.seed) {
      session.seeding = true;
      session.seed =
        session.stream?.loadInitialConsole(() => this.current === session && !this.disposed) ??
        Promise.resolve({});
    }
    return session.seed;
  }

  private replace(run: ConsoleRun): void {
    this.current.retire();
    this.current = this.createSession(run);
  }

  private createSession(run: ConsoleRun): ConsoleSession {
    let retire!: () => void;
    const retired = new Promise<void>((resolve) => {
      retire = resolve;
    });
    const session: ConsoleSession = { run, retired, retire, seeding: false };
    if (run.url) {
      const callbacks = this.options.callbacks;
      const active = () => !this.disposed && this.current === session;
      session.stream = new ConsoleStreamManager({
        ...this.options,
        buildUrl: run.url,
        callbacks: {
          onConsoleAppend: (text) => {
            if (active()) callbacks.onConsoleAppend(text);
          },
          onConsoleSet: (payload) => {
            if (active()) callbacks.onConsoleSet(payload);
          },
          onConsoleHtmlAppend: (...args) => {
            if (active()) callbacks.onConsoleHtmlAppend(...args);
          },
          onConsoleHtmlSet: (payload) => {
            if (active()) callbacks.onConsoleHtmlSet(payload);
          }
        }
      });
    }
    return session;
  }
}
