import { describe, expect, it } from "vitest";
import { formatCents, lineTotal, subtotal, tax, taxableSubtotal, taxRate } from "./pricing";

const items = [
  { sku: "TEE-BLK-M", unitPriceCents: 2400, quantity: 2 },
  { sku: "MUG-12OZ", unitPriceCents: 1350, quantity: 1 },
  { sku: "GIFT-25", unitPriceCents: 2500, quantity: 1, taxable: false }
];

describe("lineTotal", () => {
  it.each([
    [1999, 1, 1999],
    [1999, 3, 5997],
    [0, 4, 0],
    [125, 0, 0],
    [4999, 10, 49990]
  ])("prices %i cents x %i as %i", (unitPriceCents, quantity, expected) => {
    expect(lineTotal({ sku: "SKU", unitPriceCents, quantity })).toBe(expected);
  });

  it("rejects negative quantities", () => {
    expect(() => lineTotal({ sku: "SKU", unitPriceCents: 100, quantity: -1 })).toThrow(RangeError);
  });
});

describe("subtotal", () => {
  it("sums every line item", () => {
    expect(subtotal(items)).toBe(8650);
  });

  it("excludes non-taxable items from the taxable subtotal", () => {
    expect(taxableSubtotal(items)).toBe(6150);
  });

  it("returns zero for an empty cart", () => {
    expect(subtotal([])).toBe(0);
  });
});

describe("tax", () => {
  it.each([
    ["CA", 0.0725],
    ["NY", 0.04],
    ["TX", 0.0625],
    ["WA", 0.065],
    ["OR", 0]
  ])("uses the %s rate", (region, rate) => {
    expect(taxRate(region)).toBe(rate);
  });

  it.each([
    [10000, "CA", 725],
    [6150, "NY", 246],
    [999, "TX", 62],
    [12345, "WA", 802],
    [5000, "OR", 0]
  ])("taxes %i cents in %s as %i", (amount, region, expected) => {
    expect(tax(amount, region)).toBe(expected);
  });

  it("rejects unknown regions", () => {
    expect(() => taxRate("ZZ")).toThrow("No tax rule for region ZZ");
  });
});

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [1999, "$19.99"],
    [123456, "$1,234.56"]
  ])("formats %i as %s", (amount, expected) => {
    expect(formatCents(amount)).toBe(expected);
  });
});
