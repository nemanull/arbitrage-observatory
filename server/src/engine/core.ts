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
