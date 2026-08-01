import type { ExchangeSwapMarkets } from '../ccxt/types';
import type { Cluster, Slot, Opportunity } from './types';
export class Engine {
  constructor() {}

  // Let's imagine that here we got all of the ExchangeSwapMarkets
  getAllSwapMarkets() {
    const swapMarkets: ExchangeSwapMarkets[] = [];
    return swapMarkets;
  }
}


// A market that has not spoken for this long is not a price.
export const STALE_MS = 2000;

export function onQuote(s: Slot, bid: number, ask: number, now: number): Opportunity | null {
  const c = s.cluster;
  c.bid[s.i] = bid;
  c.ask[s.i] = ask;
  c.recvTs[s.i] = now;
  return evaluate(c, now);
}

function evaluate(c: Cluster, now: number): Opportunity | null {
  let bestBid = 0, sell = -1, bestAsk = Infinity, buy = -1;

  for (let i = 0; i < c.markets.length; i++) {
    if (now - c.recvTs[i] > STALE_MS) continue;
    const effBid = c.bid[i] * c.bidMul[i];
    if (effBid > bestBid) { bestBid = effBid; sell = i; }
    const effAsk = c.ask[i] * c.askMul[i];
    if (effAsk < bestAsk) { bestAsk = effAsk; buy = i; }
  }

  if (sell < 0 || buy < 0 || sell === buy) return null;
  return {
    netPpm: (bestBid / bestAsk - 1) * 1e6,
    buy:  c.markets[buy],    // Market objects directly — no id → words step
    sell: c.markets[sell],
  };
}