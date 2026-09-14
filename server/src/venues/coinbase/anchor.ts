import type { AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { CoinbaseIntxInstrument } from './types';

// The public instruments list of Coinbase International Exchange, where the -INTX perpetuals trade, carries the index, the mark and the predicted funding rate of every perpetual in one call.
// Its mark is the median of best bid, best ask and last trade clamped into a band of the index, per Coinbase's trading rules, so a coinbase leg is judged on a mark that carries no averaging.
const INSTRUMENTS_URL =
  'https://api.international.coinbase.com/api/v1/instruments';

const NS_PER_MS = 1_000_000;
const HOUR_MS = 60 * 60 * 1000;

export class CoinbaseAnchorPoller extends AnchorPoller {
  protected readonly intervalMs = 2_000; // a round is 0.5 to 0.7 s and the first after a reconnect up to 5 s, so 1 Hz would skip ticks

  protected async fetchRound(
    ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const reply = await this.getJson<CoinbaseIntxInstrument[]>(
      INSTRUMENTS_URL,
      signal,
    );
    const rows: AnchorMap = new Map();

    for (const inst of reply) {
      // A delisted entry keeps a frozen quote from its delisting day, and the base class stamps ts at arrival, so it would read as fresh.
      if (
        inst.type !== 'PERP' ||
        inst.trading_state === 'DELISTED' ||
        inst.quote === undefined
      ) {
        continue;
      }

      const intervalMs = Number(inst.funding_interval) / NS_PER_MS;
      if (!(intervalMs > 0)) {
        continue;
      }

      const mark = Number(inst.quote.mark_price);

      // The engine's raw market id is the Advanced product id, which is the INTX symbol plus -INTX.
      rows.set(`${inst.symbol}-INTX`, {
        index: Number(inst.quote.index_price),
        mark: mark > 0 ? mark : 0, // 0 is the engine's "no mark" sentinel, and NaN would be rejected as mark_invalid
        fundingRate: Number(inst.quote.predicted_funding),
        fundingIntervalHours: intervalMs / HOUR_MS,
        // INTX publishes no next funding time, and settlements land on the hour.
        nextFundingAt: Math.ceil(ts / intervalMs) * intervalMs,
      });
    }

    return rows;
  }
}
