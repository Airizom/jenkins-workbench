import { describe, expect, it } from "vitest";
import { applyDiscount, applyDiscounts, resolveCode } from "./discounts";

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

describe("applyDiscounts", () => {
  it("applies a single code like applyDiscount", () => {
    expect(applyDiscounts(10000, ["SAVE20"])).toEqual(applyDiscount(10000, "SAVE20"));
  });

  it("applies each code once", () => {
    expect(applyDiscounts(10000, ["FIVEOFF", "fiveoff"]).applied).toEqual(["FIVEOFF"]);
  });

  it("applies percentage codes before fixed-amount codes", () => {
    expect(applyDiscounts(10000, ["TENOFF", "SAVE20"]).totalCents).toBe(7000);
  });

  it("skips unknown codes", () => {
    expect(applyDiscounts(10000, ["NOPE", "WELCOME10"]).applied).toEqual(["WELCOME10"]);
  });
});
