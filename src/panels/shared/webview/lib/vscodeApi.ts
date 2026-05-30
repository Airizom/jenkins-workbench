type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState?: <T = unknown>() => T | undefined;
  setState?: <T = unknown>(state: T) => T;
};

let vscodeApiInstance: VsCodeApi | undefined;
let injectedStateApplied = false;

function applyInjectedPanelState(api: VsCodeApi): void {
  if (injectedStateApplied) {
    return;
  }
  injectedStateApplied = true;

  const windowWithState = window as {
    __JENKINS_WORKBENCH_PANEL_STATE__?: unknown;
  };
  if (!Object.prototype.hasOwnProperty.call(windowWithState, "__JENKINS_WORKBENCH_PANEL_STATE__")) {
    return;
  }

  const state = windowWithState.__JENKINS_WORKBENCH_PANEL_STATE__;
  windowWithState.__JENKINS_WORKBENCH_PANEL_STATE__ = undefined;
  api.setState?.(state);
}

export function getVsCodeApi(): VsCodeApi {
  if (!vscodeApiInstance) {
    const windowWithApi = window as {
      acquireVsCodeApi?: () => VsCodeApi;
    };
    const api = windowWithApi.acquireVsCodeApi?.();
    vscodeApiInstance = api ?? { postMessage: () => undefined };
    applyInjectedPanelState(vscodeApiInstance);
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
