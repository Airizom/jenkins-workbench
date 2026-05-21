import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../../shared/webview/components/ui/card";

export function BuildCompareErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <Card className="border-destructive-border">
      <CardHeader>
        <CardTitle>Comparison errors</CardTitle>
        <CardDescription>{errors.join(" ")}</CardDescription>
      </CardHeader>
    </Card>
  );
}
