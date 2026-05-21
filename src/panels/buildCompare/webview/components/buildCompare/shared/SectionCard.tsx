import * as React from "react";
import { Badge } from "../../../../../shared/webview/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";

export function SectionCard({
  title,
  summary,
  detail,
  status,
  children
}: React.PropsWithChildren<{
  title: string;
  summary: string;
  detail?: string;
  status: string;
}>) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{summary}</CardDescription>
            {detail ? <p className="mt-2 text-xs text-muted-foreground">{detail}</p> : null}
          </div>
          <Badge variant="outline" className="capitalize">
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
