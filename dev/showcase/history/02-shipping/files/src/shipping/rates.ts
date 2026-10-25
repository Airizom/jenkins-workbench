export type ShippingSpeed = "ground" | "express" | "overnight";

export interface ShippingQuote {
  speed: ShippingSpeed;
  amountCents: number;
  estimatedDays: number;
}

const BASE_RATES: Record<ShippingSpeed, { baseCents: number; perKgCents: number; days: number }> = {
  ground: { baseCents: 599, perKgCents: 120, days: 5 },
  express: { baseCents: 1299, perKgCents: 240, days: 2 },
  overnight: { baseCents: 2999, perKgCents: 410, days: 1 }
};

export const FREE_GROUND_THRESHOLD_CENTS = 7500;
const REMOTE_REGIONS = new Set(["AK", "HI", "PR"]);

export function quote(speed: ShippingSpeed, weightKg: number, subtotalCents: number, region: string): ShippingQuote {
  const rate = BASE_RATES[speed];
  if (speed === "ground" && subtotalCents >= FREE_GROUND_THRESHOLD_CENTS && !REMOTE_REGIONS.has(region)) {
    return { speed, amountCents: 0, estimatedDays: rate.days };
  }
  const weightCharge = Math.ceil(Math.max(weightKg, 0.5)) * rate.perKgCents;
  const remoteSurcharge = REMOTE_REGIONS.has(region) ? 1500 : 0;
  return {
    speed,
    amountCents: rate.baseCents + weightCharge + remoteSurcharge,
    estimatedDays: rate.days + (REMOTE_REGIONS.has(region) ? 2 : 0)
  };
}

export function quoteAll(weightKg: number, subtotalCents: number, region: string): ShippingQuote[] {
  return (Object.keys(BASE_RATES) as ShippingSpeed[]).map((speed) => quote(speed, weightKg, subtotalCents, region));
}

export function cheapestQuote(quotes: ShippingQuote[]): ShippingQuote | undefined {
  return [...quotes].sort((a, b) => a.amountCents - b.amountCents || a.estimatedDays - b.estimatedDays)[0];
}
