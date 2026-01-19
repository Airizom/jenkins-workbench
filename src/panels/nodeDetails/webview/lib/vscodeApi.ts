type VsCodeApi = {
  postMessage: (message: unknown) => void;
};

let vscodeApiInstance: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!vscodeApiInstance) {
    const api = (window as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi;
    vscodeApiInstance = api ? api() : { postMessage: () => undefined };
  }
  return vscodeApiInstance;
}

export function postVsCodeMessage(message: unknown): void {
  getVsCodeApi().postMessage(message);
}
