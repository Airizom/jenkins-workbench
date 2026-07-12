export interface SafePromiseSettlers<T> {
  resolve(value: T): void;
  reject(error: Error): void;
}

export function createSafePromiseSettlers<T>(
  resolve: (value: T) => void,
  reject: (error: Error) => void
): SafePromiseSettlers<T> {
  let settled = false;

  return {
    resolve(value): void {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    },
    reject(error): void {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    }
  };
}
