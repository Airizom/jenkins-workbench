type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState?: <T = unknown>() => T | undefined;
  setState?: <T = unknown>(state: T) => T;
};

let vscodeApiInstance: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!vscodeApiInstance) {
    const windowWithApi = window as {
      acquireVsCodeApi?: () => VsCodeApi;
      __vscodeApi__?: VsCodeApi;
    };
    const api = windowWithApi.__vscodeApi__ ?? windowWithApi.acquireVsCodeApi?.();
    vscodeApiInstance = api ?? { postMessage: () => undefined };
    if (!windowWithApi.__vscodeApi__ && api) {
      windowWithApi.__vscodeApi__ = api;
    }
  }
  return vscodeApiInstance;
}

export function postVsCodeMessage(message: unknown): void {
  getVsCodeApi().postMessage(message);
}

export function getVsCodeState<T = unknown>(): T | undefined {
  return getVsCodeApi().getState?.<T>();
}

export function setVsCodeState<T>(state: T): T | undefined {
  return getVsCodeApi().setState?.(state);
}
