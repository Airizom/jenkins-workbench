export type DiscountKind = "percent" | "fixed";

export interface DiscountCode {
  code: string;
  kind: DiscountKind;
  /** Percent off (0-100) or cents off, depending on `kind`. */
  value: number;
  minimumSubtotalCents?: number;
}

export interface DiscountResult {
  applied: string[];
  discountCents: number;
  totalCents: number;
}

export const DISCOUNT_CODES: Record<string, DiscountCode> = {
  SAVE20: { code: "SAVE20", kind: "percent", value: 20 },
  WELCOME10: { code: "WELCOME10", kind: "percent", value: 10 },
  FIVEOFF: { code: "FIVEOFF", kind: "fixed", value: 500 },
  TENOFF: { code: "TENOFF", kind: "fixed", value: 1000, minimumSubtotalCents: 5000 }
};

export function resolveCode(code: string): DiscountCode | undefined {
  return DISCOUNT_CODES[code.trim().toUpperCase()];
}

function discountFor(code: DiscountCode, amountCents: number): number {
  if (code.minimumSubtotalCents !== undefined && amountCents < code.minimumSubtotalCents) {
    return 0;
  }
  return code.kind === "percent" ? Math.round((amountCents * code.value) / 100) : code.value;
}

export function applyDiscount(subtotalCents: number, input: string): DiscountResult {
  const code = resolveCode(input);
  if (!code) {
    return { applied: [], discountCents: 0, totalCents: subtotalCents };
  }
  const discountCents = Math.min(discountFor(code, subtotalCents), subtotalCents);
  return { applied: [code.code], discountCents, totalCents: subtotalCents - discountCents };
}
