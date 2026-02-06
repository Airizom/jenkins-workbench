import { useToast } from "../../hooks/useToast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport
} from "./toast";

export function Toaster(): JSX.Element {
  const { toasts, dismissToast, removeToast } = useToast();

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map((toastState) => (
        <Toast
          key={toastState.id}
          open={toastState.open}
          duration={toastState.durationMs}
          variant={toastState.variant}
          onOpenChange={(open) => {
            if (!open) {
              dismissToast(toastState.id);
              setTimeout(() => {
                removeToast(toastState.id);
              }, 300);
            }
          }}
        >
          <div className="flex-1 min-w-0">
            {toastState.title ? <ToastTitle>{toastState.title}</ToastTitle> : null}
            {toastState.description ? (
              <ToastDescription>{toastState.description}</ToastDescription>
            ) : null}
          </div>
          <ToastClose aria-label="Close notification" />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
