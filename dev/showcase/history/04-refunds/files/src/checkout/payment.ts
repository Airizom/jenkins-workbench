import { validateCard } from "./validateCard";

export type PaymentStatus = "authorized" | "declined" | "requires_action";

export interface PaymentRequest {
  orderId: string;
  amountCents: number;
  currency: string;
  cardNumber: string;
}

export interface PaymentResult {
  orderId: string;
  status: PaymentStatus;
  reason?: string;
}

const SUPPORTED_CURRENCIES = new Set(["USD", "CAD", "EUR", "GBP"]);
const STEP_UP_THRESHOLD_CENTS = 100_000;

export function authorizePayment(request: PaymentRequest): PaymentResult {
  if (request.amountCents <= 0) {
    return { orderId: request.orderId, status: "declined", reason: "Amount must be positive" };
  }
  if (!SUPPORTED_CURRENCIES.has(request.currency)) {
    return { orderId: request.orderId, status: "declined", reason: `Unsupported currency ${request.currency}` };
  }
  const card = validateCard(request.cardNumber);
  if (!card.valid) {
    return { orderId: request.orderId, status: "declined", reason: card.errors.join("; ") };
  }
  if (request.amountCents >= STEP_UP_THRESHOLD_CENTS) {
    return { orderId: request.orderId, status: "requires_action", reason: "3-D Secure verification required" };
  }
  return { orderId: request.orderId, status: "authorized" };
}

export interface RefundRequest {
  orderId: string;
  capturedCents: number;
  refundedCents: number;
  amountCents: number;
}

export function refundableBalance(request: RefundRequest): number {
  return Math.max(0, request.capturedCents - request.refundedCents);
}

export function validateRefund(request: RefundRequest): string | undefined {
  if (request.amountCents <= 0) {
    return "Refund amount must be positive";
  }
  if (request.amountCents > refundableBalance(request)) {
    return `Refund exceeds the refundable balance of ${refundableBalance(request)} cents`;
  }
  return undefined;
}
