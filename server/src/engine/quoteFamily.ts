import type { Market } from './types';

export const QUOTE_FAMILY: ReadonlyMap<string, string> = new Map([
  ['USD', 'USDT'],
  ['USDC', 'USDT'],
]);

export function clusterQuote(quote: string): string {
  return QUOTE_FAMILY.get(quote) ?? quote;
}

// A venue contributes one contract per pair. Lower is better: linear before inverse, then the deepest book first.
const QUOTE_RANK: Record<string, number> = { USDT: 0, USDC: 1, USD: 2 };

export function marketRank(market: Market): number {
  return (market.linear ? 0 : 10) + (QUOTE_RANK[market.quote] ?? 5);
}
