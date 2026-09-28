import type { AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { KrakenTicker, KrakenTickersReply } from './types';

// One public call returns every contract, and public endpoints on this host have no rate limit cost.
const TICKERS_URL = 'https://futures.kraken.com/derivatives/api/v3/tickers';

// Kraken accrues funding through the hour at the period's rate and realises it on the hour, and publishes no next funding time, so both are derived here.
const INTERVAL_HOURS = 1;
const HOUR_MS = 60 * 60 * 1000;

export class KrakenFuturesAnchorPoller extends AnchorPoller {
  protected async fetchRound(
    ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const reply = await this.getJson<KrakenTickersReply>(TICKERS_URL, signal);

    if (reply.result !== 'success') {
      throw new Error(`result ${reply.result}: ${reply.error ?? ''}`);
    }

    const nextFundingAt = Math.ceil(ts / HOUR_MS) * HOUR_MS;
    const rows: AnchorMap = new Map();

    for (const ticker of reply.tickers) {
      if (!isPerpetual(ticker)) {
        continue;
      }

      rows.set(ticker.symbol, {
        index: ticker.indexPrice,
        mark: ticker.markPrice,
        // fundingRate is the running hour's rate, fixed at the top of the hour and charged at its end, and fundingRatePrediction is the hour after.
        // The venue publishes both in quote currency per contract, and dividing by the mark gives the fraction every other venue publishes.
        fundingRate: ticker.fundingRate / ticker.markPrice,
        fundingIntervalHours: INTERVAL_HOURS,
        nextFundingAt,
      });
    }

    return rows;
  }
}

// Dated contracts share the reply without funding fields, and a perpetual can be missing them in the seconds after listing.
function isPerpetual(t: KrakenTicker): t is Required<KrakenTicker> {
  return (
    t.tag === 'perpetual' &&
    typeof t.markPrice === 'number' &&
    typeof t.indexPrice === 'number' &&
    typeof t.fundingRate === 'number'
  );
}
