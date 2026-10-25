import { describe, expect, it } from "vitest";
import { type Product, score, search } from "./search";

const catalog: Product[] = [
  { sku: "TEE-BLK-M", title: "Black Logo Tee", tags: ["apparel", "cotton"], priceCents: 2400, inStock: true },
  { sku: "TEE-WHT-M", title: "White Logo Tee", tags: ["apparel", "cotton"], priceCents: 2400, inStock: false },
  { sku: "HOOD-GRY-L", title: "Grey Zip Hoodie", tags: ["apparel", "fleece"], priceCents: 5800, inStock: true },
  { sku: "MUG-12OZ", title: "Enamel Camp Mug", tags: ["kitchen", "outdoor"], priceCents: 1350, inStock: true },
  { sku: "BOTTLE-750", title: "Insulated Bottle", tags: ["kitchen", "outdoor"], priceCents: 3200, inStock: true },
  { sku: "CAP-NVY", title: "Navy Logo Cap", tags: ["apparel", "accessories"], priceCents: 1900, inStock: true }
];

describe("score", () => {
  it.each([
    ["logo", "TEE-BLK-M", 3],
    ["apparel", "TEE-BLK-M", 2],
    ["hood", "HOOD-GRY-L", 1],
    ["kitchen mug", "MUG-12OZ", 5],
    ["laptop", "MUG-12OZ", 0]
  ])("scores %s against %s as %i", (query, sku, expected) => {
    const product = catalog.find((item) => item.sku === sku);
    expect(product && score(product, query)).toBe(expected);
  });
});

describe("search", () => {
  it("ranks title matches above tag matches", () => {
    expect(search(catalog, "logo apparel").map((item) => item.sku)).toEqual([
      "CAP-NVY",
      "TEE-BLK-M",
      "TEE-WHT-M",
      "HOOD-GRY-L"
    ]);
  });

  it("filters out-of-stock products", () => {
    expect(search(catalog, "tee", { inStockOnly: true }).map((item) => item.sku)).toEqual(["TEE-BLK-M"]);
  });

  it("filters by maximum price", () => {
    expect(search(catalog, "outdoor", { maxPriceCents: 2000 }).map((item) => item.sku)).toEqual(["MUG-12OZ"]);
  });

  it("limits the number of results", () => {
    expect(search(catalog, "apparel", { limit: 2 })).toHaveLength(2);
  });

  it("lists in-stock products first when scores tie", () => {
    expect(search(catalog, "logo tee").map((item) => item.sku)).toEqual(["TEE-BLK-M", "TEE-WHT-M", "CAP-NVY"]);
  });

  it("returns nothing for an unmatched query", () => {
    expect(search(catalog, "laptop")).toEqual([]);
  });
});
