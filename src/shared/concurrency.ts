/**
 * Runs `worker` over `items` with at most `concurrency` calls in flight, starting the next item as
 * soon as any slot frees up. Results keep the input order.
 */
export async function runWithConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }
  const results: TResult[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.trunc(concurrency)), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex]);
      }
    })
  );

  return results;
}
