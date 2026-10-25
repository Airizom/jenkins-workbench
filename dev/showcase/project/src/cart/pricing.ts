export interface LineItem {
  sku: string;
  unitPriceCents: number;
  quantity: number;
  taxable?: boolean;
}

export interface TaxRule {
  region: string;
  rate: number;
}

export const TAX_RULES: TaxRule[] = [
  { region: "CA", rate: 0.0725 },
  { region: "NY", rate: 0.04 },
  { region: "TX", rate: 0.0625 },
  { region: "WA", rate: 0.065 },
  { region: "OR", rate: 0 }
];

export function lineTotal(item: LineItem): number {
  if (item.quantity < 0) {
    throw new RangeError(`Quantity must not be negative for ${item.sku}`);
  }
  return item.unitPriceCents * item.quantity;
}

export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

export function taxableSubtotal(items: LineItem[]): number {
  return items.filter((item) => item.taxable !== false).reduce((sum, item) => sum + lineTotal(item), 0);
}

export function taxRate(region: string): number {
  const rule = TAX_RULES.find((candidate) => candidate.region === region);
  if (!rule) {
    throw new Error(`No tax rule for region ${region}`);
  }
  return rule.rate;
}

export function tax(amountCents: number, region: string): number {
  return Math.round(amountCents * taxRate(region));
}

export function formatCents(amountCents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}
