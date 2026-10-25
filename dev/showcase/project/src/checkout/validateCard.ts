export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "unknown";

export interface CardValidation {
  valid: boolean;
  brand: CardBrand;
  errors: string[];
}

const BRAND_PATTERNS: Array<[CardBrand, RegExp]> = [
  ["visa", /^4\d{12}(\d{3})?(\d{3})?$/],
  ["mastercard", /^(5[1-5]\d{14}|2(2[2-9]\d|[3-6]\d{2}|7[01]\d|720)\d{12})$/],
  ["amex", /^3[47]\d{13}$/],
  ["discover", /^6(011|5\d{2})\d{12}$/]
];

export function normalizeCardNumber(input: string): string {
  return input.replace(/[\s-]/g, "");
}

export function detectBrand(number: string): CardBrand {
  const digits = normalizeCardNumber(number);
  return BRAND_PATTERNS.find(([, pattern]) => pattern.test(digits))?.[0] ?? "unknown";
}

export function passesLuhn(number: string): boolean {
  const digits = normalizeCardNumber(number);
  if (!/^\d+$/.test(digits)) {
    return false;
  }
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateCard(number: string): CardValidation {
  const errors: string[] = [];
  const brand = detectBrand(number);
  if (brand === "unknown") {
    errors.push("Unsupported card brand");
  }
  if (!passesLuhn(number)) {
    errors.push("Card number failed checksum");
  }
  return { valid: errors.length === 0, brand, errors };
}
