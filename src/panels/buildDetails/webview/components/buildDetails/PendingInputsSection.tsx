import type { PendingInputViewModel } from "../../../shared/BuildDetailsContracts";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

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
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Pending inputs</CardTitle>
        <CardDescription>Build steps are waiting for approval.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingInputs.map((input) => (
          <div
            key={input.id}
            className="rounded border border-border bg-muted/50 p-4"
          >
            <div className="flex flex-col gap-2">
              <div className="text-sm font-semibold">{input.message}</div>
              <div className="text-xs text-muted-foreground">{input.submitterLabel}</div>
              <div className="text-xs text-muted-foreground">{input.parametersLabel}</div>
              {input.parameters.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                  {input.parameters.map((param) => (
                    <span
                      key={`${input.id}-${param.name}`}
                      className="rounded border border-border px-2 py-0.5"
                    >
                      {param.name} ({param.kind})
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onApprove(input.id)}>
                Approve
              </Button>
              <Button variant="outline" size="sm" onClick={() => onReject(input.id)}>
                Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
