import type { PairKey } from './types';

// Tickers that name a different token on one venue, see section 2c of docs/audits/2026-09-05-first-run-data-audit.md.
// The open gate cannot tell two tokens apart, because its fresh edge compares each book only to its own venue's mark.
// A standing basis needs no entry, because the open gate refuses a cross that the anchors explain, see docs/research/2026-09-15-denied-basis-pairs-gate-probe.md.
// A leg whose index basket is its own perp does need one, because its mark trails the perp and the fresh edge on that leg reads momentum, see docs/research/2026-09-15-one-self-index-fresh-gate.md.
export const DENIED_PAIRS: ReadonlySet<PairKey> = new Set<PairKey>([
  'BB|USDT', // BounceBit on binance and bybit, a different token on okx
  'ON|USDT', // one token on binance, another on okx and bybit
  'QNT|USDT', // Quant on binance and bybit, a different token on okx
  'ONE|USDT', // binance's index basket is the binance perp itself at weight 1.0, the only such basket among 564 USD-M perps on 2026-09-15
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
