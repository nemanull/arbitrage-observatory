import type { PairKey } from './types';

export const DENIED_PAIRS: ReadonlySet<PairKey> = new Set<PairKey>([
  'BB|USDT',
  'ON|USDT',
  'QNT|USDT',
  'ONE|USDT', // Same asset, but the two venues' index baskets sit 5.3% apart, so the perps never converge (2026-09-06 audit, 2a).
  // Standing bases: every episode in the third run ran to the five minute age cap without converging, so the spread is a basis and not an arbitrage.
  // Denied by hand until the index, mark and funding classification replaces this list, see docs/backlog/2026-09-07-standing-basis-classification.md.
  'OPENAI|USDT', // pre-IPO synthetic, 37 of 37 episodes hit the age cap, peak about 21,000 ppm
  'ANTHROPIC|USDT', // pre-IPO synthetic, 33 of 33 hit the age cap, peak about 13,000 ppm
  'ONG|USDT', // 32 of 33 hit the age cap on bybit-binance, peak about 7,100 ppm
  'SIREN|USDT', // 26 of 27 hit the age cap on bybit-binance, the venues' indices sit 1.7% apart
]);

export type PriceScale = {
  venueId: string;
  rawMarketId: string;
  scale: number;
};

export const PRICE_SCALE: readonly PriceScale[] = [
  { venueId: 'okx', rawMarketId: 'ANTHROPIC-USDT-SWAP', scale: 10 },
  { venueId: 'okx', rawMarketId: 'OPENAI-USDT-SWAP', scale: 10 },
];

const scaleByMarket = new Map<string, number>(
  PRICE_SCALE.map((s) => [`${s.venueId}|${s.rawMarketId}`, s.scale]),
);

export function getPriceScale(venueId: string, rawMarketId: string): number {
  return scaleByMarket.get(`${venueId}|${rawMarketId}`) ?? 1;
}
