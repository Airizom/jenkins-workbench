import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function BuildFailureEmptyStateCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          No changelog, failed tests, or artifacts were reported for this build.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-border px-4 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <InfoIcon />
          </div>
          <div className="text-sm text-muted-foreground">Nothing to highlight for this run</div>
        </div>
      </CardContent>
    </Card>
  );
}
