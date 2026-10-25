export type DiscountKind = "percent" | "fixed";

export interface DiscountCode {
  code: string;
  kind: DiscountKind;
  /** Percent off (0-100) or cents off, depending on `kind`. */
  value: number;
  minimumSubtotalCents?: number;
  /** ISO date after which the code is rejected. */
  expiresAt?: string;
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
  TENOFF: { code: "TENOFF", kind: "fixed", value: 1000, minimumSubtotalCents: 5000 },
  SPRING25: { code: "SPRING25", kind: "fixed", value: 2500, expiresAt: "2026-06-01" },
  HOLIDAY15: { code: "HOLIDAY15", kind: "fixed", value: 1500, expiresAt: "2027-01-01" }
};

export function isCodeExpired(code: DiscountCode, now = new Date()): boolean {
  return code.expiresAt !== undefined && Date.parse(code.expiresAt) <= now.getTime();
}

export function resolveCode(input: string, now = new Date()): DiscountCode | undefined {
  const code = DISCOUNT_CODES[input.trim().toUpperCase()];
  return code && !isCodeExpired(code, now) ? code : undefined;
}

function discountFor(code: DiscountCode, amountCents: number): number {
  if (code.minimumSubtotalCents !== undefined && amountCents < code.minimumSubtotalCents) {
    return 0;
  }
  return code.kind === "percent" ? Math.round((amountCents * code.value) / 100) : code.value;
}

export function applyDiscounts(subtotalCents: number, inputs: string[], now = new Date()): DiscountResult {
  const codes = inputs
    .map((input) => resolveCode(input, now))
    .filter((code): code is DiscountCode => code !== undefined)
    .filter((code, index, all) => all.findIndex((other) => other.code === code.code) === index);
  let remainingCents = subtotalCents;
  for (const code of codes) {
    remainingCents -= discountFor(code, remainingCents);
  }
  const limitCents: number = maxDiscountFor(codes, subtotalCents);
  const discountCents = Math.min(subtotalCents - remainingCents, limitCents);
  return { applied: codes.map((code) => code.code), discountCents, totalCents: remainingCents };
}

function maxDiscountFor(codes: DiscountCode[], subtotalCents: number): number | undefined {
  return codes.length > 0 ? subtotalCents : undefined;
}

export function applyDiscount(subtotalCents: number, input: string): DiscountResult {
  const code = resolveCode(input);
  if (!code) {
    return { applied: [], discountCents: 0, totalCents: subtotalCents };
  }
  const discountCents = Math.min(discountFor(code, subtotalCents), subtotalCents);
  return { applied: [code.code], discountCents, totalCents: subtotalCents - discountCents };
}
