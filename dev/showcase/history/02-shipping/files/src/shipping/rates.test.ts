import { describe, expect, it } from "vitest";
import { cheapestQuote, quote, quoteAll } from "./rates";

describe("quote", () => {
  it.each([
    ["ground", 1, 719],
    ["ground", 2.2, 959],
    ["express", 1, 1539],
    ["overnight", 3, 4229]
  ] as const)("prices %s at %d kg", (speed, weightKg, expected) => {
    expect(quote(speed, weightKg, 2000, "CA").amountCents).toBe(expected);
  });

  it("ships ground for free above the threshold", () => {
    expect(quote("ground", 4, 7500, "CA")).toEqual({ speed: "ground", amountCents: 0, estimatedDays: 5 });
  });

  it("charges remote regions even above the threshold", () => {
    expect(quote("ground", 1, 9000, "HI")).toEqual({ speed: "ground", amountCents: 2219, estimatedDays: 7 });
  });

  it("bills at least half a kilogram", () => {
    expect(quote("express", 0.1, 2000, "NY").amountCents).toBe(1539);
  });
});

describe("cheapestQuote", () => {
  it("prefers the lowest price", () => {
    expect(cheapestQuote(quoteAll(1, 2000, "CA"))?.speed).toBe("ground");
  });

  it("returns undefined without quotes", () => {
    expect(cheapestQuote([])).toBeUndefined();
  });
});
