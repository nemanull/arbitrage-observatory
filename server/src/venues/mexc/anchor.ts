import type { AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import { RateLimitReplyError } from '../../shared/errors';
import type { MexcFundingRate, MexcReply } from './types';

// One call returns index, mark, rate, interval and next settlement for every contract of every family.
// It is documented at 20 calls per 2 s, so the default one second cadence uses a tenth of it.
const FUNDING_URL = 'https://api.mexc.com/api/v1/contract/funding_rate';

// MEXC reports its rate limit inside an HTTP 200 body and sends no Retry-After, so the pause is the base class default.
const RATE_LIMIT_CODE = 510;

export class MexcAnchorPoller extends AnchorPoller {
  protected async fetchRound(
    _ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const reply = await this.getJson<MexcReply<MexcFundingRate[]>>(
      FUNDING_URL,
      signal,
    );

    if (reply.code === RATE_LIMIT_CODE) {
      throw new RateLimitReplyError(FUNDING_URL, reply.code);
    }

    if (reply.success !== true || reply.code !== 0) {
      throw new Error(`code ${reply.code}: ${reply.message ?? ''}`);
    }

    // The reply also carries a few rows with no catalog entry, and the base class reads only tracked ids.
    const rows: AnchorMap = new Map();
    for (const r of reply.data) {
      rows.set(r.symbol, {
        index: r.idxPrice,
        mark: r.fairPrice,
        fundingRate: r.fundingRate,
        fundingIntervalHours: r.collectCycle,
        nextFundingAt: r.nextSettleTime,
      });
    }

    return rows;
  }
}
