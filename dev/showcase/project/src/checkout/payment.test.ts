import { describe, expect, it } from "vitest";
import { authorizePayment } from "./payment";

const base = { orderId: "ord_1001", currency: "USD", cardNumber: "4242 4242 4242 4242" };

describe("authorizePayment", () => {
  it("authorizes an ordinary order", () => {
    expect(authorizePayment({ ...base, amountCents: 8650 }).status).toBe("authorized");
  });

  it.each([0, -100])("declines a non-positive amount of %i", (amountCents) => {
    expect(authorizePayment({ ...base, amountCents })).toMatchObject({ status: "declined" });
  });

  it.each(["USD", "CAD", "EUR", "GBP"])("accepts %s", (currency) => {
    expect(authorizePayment({ ...base, currency, amountCents: 500 }).status).toBe("authorized");
  });

  it.each(["JPY", "AUD", "usd"])("declines unsupported currency %s", (currency) => {
    expect(authorizePayment({ ...base, currency, amountCents: 500 }).status).toBe("declined");
  });

  it("declines an invalid card", () => {
    expect(authorizePayment({ ...base, cardNumber: "4242424242424241", amountCents: 500 })).toEqual({
      orderId: "ord_1001",
      status: "declined",
      reason: "Card number failed checksum"
    });
  });

  it("requires step-up verification for large orders", () => {
    expect(authorizePayment({ ...base, amountCents: 125_000 }).status).toBe("requires_action");
  });
});
