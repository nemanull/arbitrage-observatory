import type { AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { BybitTicker, BybitTickersReply } from './types';

// One call per market family returns every contract with index, mark, rate, next settlement, interval and cap.
const LINEAR_URL = 'https://api.bybit.com/v5/market/tickers?category=linear';
const INVERSE_URL = 'https://api.bybit.com/v5/market/tickers?category=inverse';

// The linear reply is 630 KB and its download alone reached 850 ms at one hertz on 2026-09-10, so this venue polls every two seconds.
const INTERVAL_MS = 2_000;

// A 403 means too many requests, and the venue asks for a ten minute silence before the next one.
const RATE_LIMIT_PAUSE_MS = 10 * 60 * 1000;

export class BybitAnchorPoller extends AnchorPoller {
  protected readonly intervalMs = INTERVAL_MS;
  protected readonly rateLimitPauseMs = RATE_LIMIT_PAUSE_MS;

  protected async fetchRound(
    _ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const replies = await Promise.all(
      this.families().map((url) =>
        this.getJson<BybitTickersReply>(url, signal),
      ),
    );

    const rows: AnchorMap = new Map();
    for (const reply of replies) {
      if (reply.retCode !== 0) {
        throw new Error(`retCode ${reply.retCode}: ${reply.retMsg}`);
      }

      for (const ticker of reply.result.list) {
        const row = toRow(ticker);
        if (row !== null) {
          rows.set(ticker.symbol, row);
        }
      }
    }

    return rows;
  }

  private families(): string[] {
    const urls: string[] = [];
    if (this.venue.markets.some((m) => m.linear)) {
      urls.push(LINEAR_URL);
    }
    if (this.venue.markets.some((m) => !m.linear)) {
      urls.push(INVERSE_URL);
    }
    return urls;
  }
}

// A dated future shares the reply and carries empty funding fields, and it is never a tracked market, so it is left out.
function toRow(t: BybitTicker) {
  if (t.fundingRate === '' || t.fundingIntervalHour === '') {
    return null;
  }

  return {
    index: Number(t.indexPrice),
    mark: Number(t.markPrice),
    fundingRate: Number(t.fundingRate),
    fundingIntervalHours: Number(t.fundingIntervalHour),
    nextFundingAt: Number(t.nextFundingTime),
  };
}
