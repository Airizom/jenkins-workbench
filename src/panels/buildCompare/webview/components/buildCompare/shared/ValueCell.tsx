import { CompareValueCellShell } from "./CompareValueCellShell";
export function ValueCell({ label, value }: { label: string; value?: string }) {
  return (
    <CompareValueCellShell label={label}>
      <p className="break-all font-mono text-vscode-editor">{value ?? "-"}</p>
    </CompareValueCellShell>
  );
}
