import type { AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { BitstampFundingRate, BitstampTicker } from './types';

// One call carries index and mark for every market, spot rows included.
const TICKER_URL = 'https://www.bitstamp.net/api/v2/ticker/';

// Funding has no bulk call, and every market each second would be 12,000 requests per 10 minutes against a limit of 10,000.
// One market per round keeps the poller at two requests a second, while a rate changed at most 11 times in 201 s.
const FUNDING_URL = 'https://www.bitstamp.net/api/v2/funding_rate/';

// No interval field exists, and every perpetual settles every 8 hours.
const FUNDING_INTERVAL_HOURS = 8;

type FundingReading = {
  rate: number;
  nextFundingAt: number; // Unix ms
};

export class BitstampAnchorPoller extends AnchorPoller {
  private readonly funding = new Map<string, FundingReading>(); // by rawMarketId
  private readonly warnedFunding = new Set<string>();
  private nextFunding = 0; // index into venue.markets of the next funding read

  protected async fetchRound(
    _ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const [[tickers, arrivedAt]] = await Promise.all([
      this.getJson<BitstampTicker[]>(TICKER_URL, signal).then(
        (reply) => [reply, Date.now()] as const,
      ),
      this.readFunding(signal),
    ]);

    const rows: AnchorMap = new Map();
    for (const t of tickers) {
      if (t.market_type !== 'PERPETUAL') {
        continue;
      }

      // The ticker spells the market 'BTC/USD-PERP', and the id is 'btcusd-perp'.
      const rawMarketId = t.market.replace('/', '').toLowerCase();
      const funding = this.funding.get(rawMarketId);
      if (funding === undefined) {
        continue;
      }

      rows.set(rawMarketId, {
        index: Number(t.index_price),
        mark: Number(t.mark_price),
        fundingRate: funding.rate,
        fundingIntervalHours: FUNDING_INTERVAL_HOURS,
        nextFundingAt: funding.nextFundingAt,
        // The edge served cached replies in under 20 ms, so arrival says nothing about the numbers' age and only caps the ticker's own second.
        ts: Math.min(Number(t.timestamp) * 1000, arrivedAt),
      });
    }

    return rows;
  }

  // A market keeps its last reading until its turn comes again, and one that never answers stays out of the rows.
  private async readFunding(signal: AbortSignal): Promise<void> {
    const markets = this.venue.markets;
    const rawMarketId = markets[this.nextFunding].rawMarketId;
    this.nextFunding = (this.nextFunding + 1) % markets.length;

    try {
      const reply = await this.getJson<BitstampFundingRate>(
        `${FUNDING_URL}${rawMarketId}/`,
        signal,
      );

      this.funding.set(rawMarketId, {
        rate: Number(reply.funding_rate),
        nextFundingAt: Number(reply.next_funding_time) * 1000,
      });
    } catch (e) {
      if (signal.aborted || this.warnedFunding.has(rawMarketId)) {
        return;
      }

      this.warnedFunding.add(rawMarketId);
      this.logger.warn(
        `funding read for ${rawMarketId} failed: ${(e as Error).message}`,
      );
    }
  }
}
