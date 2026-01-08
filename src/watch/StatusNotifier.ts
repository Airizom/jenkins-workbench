export type CompletionStatusKind =
  | "success"
  | "failure"
  | "unstable"
  | "aborted"
  | "notBuilt"
  | "disabled"
  | "unknown";

export interface CompletionNotification {
  jobLabel: string;
  environmentUrl: string;
  result?: string;
  color?: string;
}

export interface PendingInputNotification {
  jobLabel: string;
  environmentUrl: string;
  buildUrl: string;
  inputCount: number;
  inputMessage?: string;
}

export interface StatusNotifier {
  notifyFailure(message: string): void;
  notifyRecovery(message: string): void;
  notifyWatchError(message: string): void;
  notifyCompletion(notification: CompletionNotification): void;
  notifyPendingInput(notification: PendingInputNotification): void;
}
