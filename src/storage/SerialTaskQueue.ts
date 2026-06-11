export type SerialTaskQueue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Serializes async tasks so each one starts only after the previous one settles.
 * Memento mutations are read-modify-write, so concurrent callers (for example a
 * user action racing the status poller) must not interleave.
 */
export function createSerialTaskQueue(): SerialTaskQueue {
  let tail: Promise<void> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}
