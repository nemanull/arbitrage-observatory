import type { AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { GateContract } from './types';

// One call returns index, mark, rate, interval and next settlement for every USDT contract.
// The reply holds every contract only while the URL carries no `limit`, since `limit=100` returns 100 rows.
const CONTRACTS_URL = 'https://api.gateio.ws/api/v4/futures/usdt/contracts';

// Gate counts 200 requests per endpoint per 10 s and sends no Retry-After, so a pause of one window is enough.
const RATE_LIMIT_PAUSE_MS = 10_000;

const SECONDS_PER_HOUR = 3_600;

export class GateAnchorPoller extends AnchorPoller {
  protected readonly rateLimitPauseMs = RATE_LIMIT_PAUSE_MS;

  protected async fetchRound(
    _ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const contracts = await this.getJson<GateContract[]>(CONTRACTS_URL, signal);
    const rows: AnchorMap = new Map();

    for (const contract of contracts) {
      // A pre market contract has no index basket to anchor it.
      if (contract.is_pre_market || contract.status !== 'trading') {
        continue;
      }

      rows.set(contract.name, {
        index: Number(contract.index_price),
        mark: Number(contract.mark_price),
        fundingRate: Number(contract.funding_rate),
        fundingIntervalHours: contract.funding_interval / SECONDS_PER_HOUR,
        nextFundingAt: contract.funding_next_apply * 1_000,
      });
    }

    return rows;
  }
}
