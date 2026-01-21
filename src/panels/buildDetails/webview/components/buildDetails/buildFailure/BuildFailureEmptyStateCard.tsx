import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";

export function BuildFailureEmptyStateCard({
  title,
}: {
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          No changelog, failed tests, or artifacts were reported for this build.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          Nothing to highlight for this run.
        </div>
      </CardContent>
    </Card>
  );
}
