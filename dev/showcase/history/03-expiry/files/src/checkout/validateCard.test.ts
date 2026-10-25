import { describe, expect, it } from "vitest";
import { detectBrand, isExpired, normalizeCardNumber, passesLuhn, validateCard } from "./validateCard";

describe("normalizeCardNumber", () => {
  it.each([
    ["4242 4242 4242 4242", "4242424242424242"],
    ["4242-4242-4242-4242", "4242424242424242"],
    [" 378282246310005 ", "378282246310005"]
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCardNumber(input)).toBe(expected);
  });
});

describe("detectBrand", () => {
  it.each([
    ["4242424242424242", "visa"],
    ["4000056655665556", "visa"],
    ["5555555555554444", "mastercard"],
    ["2223003122003222", "mastercard"],
    ["378282246310005", "amex"],
    ["371449635398431", "amex"],
    ["6011111111111117", "discover"],
    ["6500000000000002", "discover"],
    ["9999999999999999", "unknown"]
  ])("detects %s as %s", (number, brand) => {
    expect(detectBrand(number)).toBe(brand);
  });
});

describe("passesLuhn", () => {
  it.each([
    ["4242424242424242", true],
    ["4242424242424241", false],
    ["378282246310005", true],
    ["6011111111111117", true],
    ["1234567812345678", false],
    ["4242-abcd-4242-4242", false]
  ])("checks %s", (number, expected) => {
    expect(passesLuhn(number)).toBe(expected);
  });
});

describe("validateCard", () => {
  it("accepts a valid Visa card", () => {
    expect(validateCard("4242 4242 4242 4242")).toEqual({ valid: true, brand: "visa", errors: [] });
  });

  it("reports both brand and checksum errors", () => {
    expect(validateCard("9999 9999 9999 9990").errors).toEqual([
      "Unsupported card brand",
      "Card number failed checksum"
    ]);
  });
});

describe("isExpired", () => {
  const now = new Date(Date.UTC(2026, 8, 15));

  it.each([
    [9, 2026, false],
    [8, 2026, true],
    [12, 26, false],
    [1, 27, false],
    [13, 2027, true],
    [0, 2027, true]
  ])("treats %i/%i as expired=%s", (month, year, expected) => {
    expect(isExpired(month, year, now)).toBe(expected);
  });

  it("rejects an expired card", () => {
    expect(validateCard("4242424242424242", { month: 1, year: 2025 }, now).errors).toEqual(["Card has expired"]);
  });
});
