type VsCodeApi = {
  postMessage: (message: unknown) => void;
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
