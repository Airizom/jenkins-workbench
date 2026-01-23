import type { PendingInputViewModel } from "../../../shared/BuildDetailsContracts";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Card, CardContent } from "../../../../shared/webview/components/ui/card";

function AlertCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function PendingInputsSection({
  pendingInputs,
  onApprove,
  onReject
}: {
  pendingInputs: PendingInputViewModel[];
  onApprove: (inputId: string) => void;
  onReject: (inputId: string) => void;
}) {
  if (pendingInputs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {pendingInputs.map((input) => (
        <Card key={input.id} className="overflow-hidden border-warning/50">
          <div className="flex items-center gap-3 border-b border-border bg-warning/5 px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
              <AlertCircleIcon />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{input.message}</div>
              {input.submitterLabel ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserIcon />
                  {input.submitterLabel}
                </div>
              ) : null}
            </div>
          </div>

          <CardContent className="p-4">
            {input.parameters.length > 0 ? (
              <div className="mb-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Parameters
                </div>
                <div className="flex flex-wrap gap-2">
                  {input.parameters.map((param) => (
                    <Badge
                      key={`${input.id}-${param.name}`}
                      variant="secondary"
                      className="font-mono text-xs"
                    >
                      {param.name}
                      <span className="ml-1 text-muted-foreground">({param.kind})</span>
                    </Badge>
                  ))}
                </div>
                {input.parametersLabel ? (
                  <div className="mt-2 text-xs text-muted-foreground">{input.parametersLabel}</div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => onApprove(input.id)}
                className="gap-1.5"
              >
                <CheckIcon />
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReject(input.id)}
                className="gap-1.5"
              >
                <XIcon />
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
