import { describe, expect, it } from "vitest";
import { applyDiscount, resolveCode } from "./discounts";

describe("resolveCode", () => {
  it.each(["SAVE20", "save20", "  Save20 "])("resolves %s", (input) => {
    expect(resolveCode(input)?.code).toBe("SAVE20");
  });

  it("ignores unknown codes", () => {
    expect(resolveCode("FREESTUFF")).toBeUndefined();
  });
});

describe("applyDiscount", () => {
  it.each([
    [10000, "SAVE20", 2000],
    [8650, "WELCOME10", 865],
    [8650, "FIVEOFF", 500],
    [8650, "TENOFF", 1000],
    [4999, "TENOFF", 0]
  ])("discounts %i cents with %s by %i", (subtotal, code, expected) => {
    expect(applyDiscount(subtotal, code).discountCents).toBe(expected);
  });

  it("never discounts below zero", () => {
    expect(applyDiscount(300, "FIVEOFF")).toEqual({ applied: ["FIVEOFF"], discountCents: 300, totalCents: 0 });
  });
});
