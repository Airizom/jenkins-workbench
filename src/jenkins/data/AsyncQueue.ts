const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error("Unexpected error.");
};

export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly pending: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private error?: Error;

  push(item: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.pending.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.pending.length > 0) {
      this.pending.shift()?.resolve({ value: undefined as T, done: true });
    }
  }

  fail(error: unknown): void {
    if (this.closed) {
      return;
    }
    this.error = toError(error);
    this.closed = true;
    while (this.pending.length > 0) {
      this.pending.shift()?.reject(this.error);
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.error) {
      throw this.error;
    }
    if (this.items.length > 0) {
      return { value: this.items.shift() as T, done: false };
    }
    if (this.closed) {
      return { value: undefined as T, done: true };
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

export class JobQueue<T> {
  private readonly items: T[] = [];
  private readonly pending: Array<(item?: T) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.pending.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  async shift(): Promise<T | undefined> {
    if (this.items.length > 0) {
      return this.items.shift();
    }
    if (this.closed) {
      return undefined;
    }
    return new Promise((resolve) => {
      this.pending.push(resolve);
    });
  }

  clear(): number {
    const removed = this.items.length;
    this.items.length = 0;
    return removed;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.pending.length > 0) {
      this.pending.shift()?.(undefined);
    }
  }
}
