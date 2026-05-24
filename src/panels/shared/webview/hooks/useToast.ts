import * as React from "react";

export type ToastVariant = "default" | "success" | "destructive";

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

export interface ToastState extends ToastOptions {
  id: string;
  open: boolean;
}

type Listener = (toasts: ToastState[]) => void;

const TOAST_REMOVE_DELAY_MS = 300;

let currentToasts: ToastState[] = [];
const listeners = new Set<Listener>();
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const listener of listeners) {
    listener(currentToasts);
  }
}

function generateId(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function clearDismissTimeout(id: string): void {
  const existing = timeouts.get(id);
  if (existing !== undefined) {
    clearTimeout(existing);
    timeouts.delete(id);
  }
}

function scheduleDismiss(id: string, durationMs: number): void {
  clearDismissTimeout(id);
  const timeout = setTimeout(() => {
    timeouts.delete(id);
    dismissToast(id);
  }, durationMs);
  timeouts.set(id, timeout);
}

function scheduleRemove(id: string): void {
  clearDismissTimeout(id);
  const timeout = setTimeout(() => {
    timeouts.delete(id);
    removeToast(id);
  }, TOAST_REMOVE_DELAY_MS);
  timeouts.set(id, timeout);
}

export function toast(options: ToastOptions): { id: string; dismiss: () => void } {
  const id = generateId();
  const durationMs = options.durationMs ?? 3000;

  const next: ToastState = {
    id,
    open: true,
    title: options.title,
    description: options.description,
    variant: options.variant ?? "default",
    durationMs
  };

  const cappedToasts = [next, ...currentToasts].slice(0, 5);
  const cappedToastIds = new Set(cappedToasts.map((toastState) => toastState.id));
  for (const toastState of currentToasts) {
    if (!cappedToastIds.has(toastState.id)) {
      clearDismissTimeout(toastState.id);
    }
  }
  currentToasts = cappedToasts;
  emit();
  scheduleDismiss(id, durationMs);

  return { id, dismiss: () => dismissToast(id) };
}

export function dismissToast(id?: string): void {
  if (!id) {
    currentToasts = currentToasts.map((toastState) => ({ ...toastState, open: false }));
    for (const toastState of currentToasts) {
      scheduleRemove(toastState.id);
    }
    emit();
    return;
  }
  currentToasts = currentToasts.map((toastState) =>
    toastState.id === id ? { ...toastState, open: false } : toastState
  );
  scheduleRemove(id);
  emit();
}

export function removeToast(id: string): void {
  clearDismissTimeout(id);
  currentToasts = currentToasts.filter((toastState) => toastState.id !== id);
  emit();
}

export function useToast(): {
  toasts: ToastState[];
  toast: typeof toast;
  dismissToast: typeof dismissToast;
  removeToast: typeof removeToast;
} {
  const [toasts, setToasts] = React.useState<ToastState[]>(currentToasts);

  React.useEffect(() => {
    const listener: Listener = (next) => {
      setToasts(next);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { toasts, toast, dismissToast, removeToast };
}
