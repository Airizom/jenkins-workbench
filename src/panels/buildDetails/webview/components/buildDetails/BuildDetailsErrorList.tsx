import { Alert, AlertDescription } from "../../../../shared/webview/components/ui/alert";

type BuildDetailsErrorListProps = {
  errors: string[];
};

export function BuildDetailsErrorList({ errors }: BuildDetailsErrorListProps): JSX.Element | null {
  if (errors.length === 0) {
    return null;
  }

  return (
    <Alert id="errors" variant="destructive" className="mb-3 flex flex-col gap-1">
      {errors.map((error) => (
        <AlertDescription className="text-xs" key={error}>
          {error}
        </AlertDescription>
      ))}
    </Alert>
  );
}
