import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";

export function BuildFailureEmptyStateCard({
  title,
}: {
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          No changelog, failed tests, or artifacts were reported for this build.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground text-sm">
          Nothing to highlight for this run.
        </div>
      </CardContent>
    </Card>
  );
}
