export interface Product {
  sku: string;
  title: string;
  tags: string[];
  priceCents: number;
  inStock: boolean;
}

export interface SearchOptions {
  inStockOnly?: boolean;
  maxPriceCents?: number;
  limit?: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function score(product: Product, query: string): number {
  const terms = tokenize(query);
  const title = tokenize(product.title);
  const tags = product.tags.map((tag) => tag.toLowerCase());
  return terms.reduce((total, term) => {
    if (title.includes(term)) return total + 3;
    if (tags.includes(term)) return total + 2;
    if (title.some((word) => word.startsWith(term))) return total + 1;
    return total;
  }, 0);
}

export function search(products: Product[], query: string, options: SearchOptions = {}): Product[] {
  return products
    .filter((product) => !options.inStockOnly || product.inStock)
    .filter((product) => options.maxPriceCents === undefined || product.priceCents <= options.maxPriceCents)
    .map((product) => ({ product, score: score(product, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.product.priceCents - b.product.priceCents)
    .slice(0, options.limit ?? 20)
    .map((entry) => entry.product);
}
