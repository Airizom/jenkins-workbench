import { Alert, AlertDescription } from "./ui/alert";
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card";

type PanelErrorListProps = {
  errors: string[];
  variant?: "alert" | "card";
  title?: string;
  id?: string;
  className?: string;
};

export function PanelErrorList({
  errors,
  variant = "alert",
  title = "Comparison errors",
  id,
  className
}: PanelErrorListProps): JSX.Element | null {
  if (errors.length === 0) {
    return null;
  }

  if (variant === "card") {
    return (
      <Card className={className ?? "border-destructive-border"}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{errors.join(" ")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Alert id={id} variant="destructive" className={className ?? "mb-3 flex flex-col gap-1"}>
      {errors.map((error) => (
        <AlertDescription className="text-xs" key={error}>
          {error}
        </AlertDescription>
      ))}
    </Alert>
  );
}
