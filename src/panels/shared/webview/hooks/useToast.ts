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

function scheduleDismiss(id: string, durationMs: number): void {
  const existing = timeouts.get(id);
  if (existing) {
    clearTimeout(existing);
  }
  const timeout = setTimeout(() => {
    dismissToast(id);
  }, durationMs);
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

  currentToasts = [next, ...currentToasts].slice(0, 5);
  emit();
  scheduleDismiss(id, durationMs);

  return { id, dismiss: () => dismissToast(id) };
}

export function dismissToast(id?: string): void {
  if (!id) {
    currentToasts = currentToasts.map((toastState) => ({ ...toastState, open: false }));
    emit();
    return;
  }
  currentToasts = currentToasts.map((toastState) =>
    toastState.id === id ? { ...toastState, open: false } : toastState
  );
  emit();
}

export function removeToast(id: string): void {
  const existing = timeouts.get(id);
  if (existing) {
    clearTimeout(existing);
    timeouts.delete(id);
  }
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

