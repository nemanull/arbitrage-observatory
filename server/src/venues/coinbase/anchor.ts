import type { AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { CoinbaseProductsReply } from './types';

// The public products list is the one Coinbase Advanced call that carries an index and a funding rate for the perpetuals.
// It carries no mark, so the mark column stays at zero for this venue.
const PRODUCTS_URL =
  'https://api.coinbase.com/api/v3/brokerage/market/products?product_type=FUTURE&contract_expiry_type=PERPETUAL';

const SECOND_MS = 1_000;
const HOUR_MS = 60 * 60 * 1000;

export class CoinbaseAnchorPoller extends AnchorPoller {
  protected async fetchRound(
    _ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const reply = await this.getJson<CoinbaseProductsReply>(
      PRODUCTS_URL,
      signal,
    );
    const rows: AnchorMap = new Map();

    for (const product of reply.products) {
      const details = product.future_product_details;
      if (details === undefined || details === null) {
        continue;
      }

      const intervalMs = seconds(details.funding_interval) * SECOND_MS;
      if (!(intervalMs > 0)) {
        continue;
      }

      rows.set(product.product_id, {
        index: Number(details.index_price),
        mark: 0,
        fundingRate: Number(details.funding_rate),
        fundingIntervalHours: intervalMs / HOUR_MS,
        // funding_time is the last settlement, and the next one is one interval later.
        nextFundingAt: Date.parse(details.funding_time) + intervalMs,
      });
    }

    return rows;
  }
}

// '3600s' on every perpetual on 2026-09-10.
function seconds(interval: string): number {
  return interval.endsWith('s') ? Number(interval.slice(0, -1)) : NaN;
}
