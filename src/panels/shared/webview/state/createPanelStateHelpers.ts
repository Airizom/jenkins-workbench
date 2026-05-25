export const FALLBACK_UPDATED_AT = "1970-01-01T00:00:00.000Z";

export function readInjectedPanelState<TViewModel>(): TViewModel | undefined {
  return (window as { __INITIAL_STATE__?: TViewModel }).__INITIAL_STATE__;
}

export function readInitialPanelState<TViewModel, TState extends TViewModel>(
  fallback: TState,
  buildInitial: (viewModel: TViewModel) => TState
): TState {
  const candidate = readInjectedPanelState<TViewModel>();
  if (!candidate) {
    return fallback;
  }
  return buildInitial(candidate);
}

export function preserveLoadingOnFullUpdate<TState extends { loading: boolean }>(
  currentState: TState,
  nextState: TState
): TState {
  return {
    ...nextState,
    loading: currentState.loading
  };
}

export function createLoadingPanelStateHelpers<
  TViewModel,
  TState extends TViewModel & { loading: boolean; hasLoaded: boolean }
>(options: {
  fallback: TState;
  buildInitial: (viewModel: TViewModel) => TState;
}) {
  return {
    getInitialState(): TState {
      return readInitialPanelState(options.fallback, options.buildInitial);
    },
    handleSetLoading(state: TState, value: boolean): TState {
      return { ...state, loading: value };
    },
    handleFullUpdate(state: TState, viewModel: TViewModel): TState {
      return preserveLoadingOnFullUpdate(state, options.buildInitial(viewModel));
    }
  };
}
