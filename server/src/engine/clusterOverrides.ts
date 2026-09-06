import type { PairKey } from './types';

export const DENIED_PAIRS: ReadonlySet<PairKey> = new Set<PairKey>([
  'BB|USDT',
  'ON|USDT',
  'QNT|USDT',
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
