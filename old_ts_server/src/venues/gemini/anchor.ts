import type { AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { GeminiFundingAmount, GeminiRiskStats } from './types';

// No bulk call exists, so index and mark take one request per symbol.
const RISKSTATS_URL = 'https://api.gemini.com/v1/riskstats/';
const FUNDING_URL = 'https://api.gemini.com/v1/fundingamount/';

// The public limit is 120 requests a minute, and 90 leaves the rest to the funding call.
const RISKSTATS_PER_MINUTE = 90;
const MIN_INTERVAL_MS = 3_000;

// The estimate changes once a minute and REST shows it about 20 s after the socket does.
const FUNDING_MAX_AGE_MS = 60_000;

const HOUR_MS = 60 * 60 * 1000;

type FundingReading = {
  amount: number; // estimatedFundingAmount
  intervalHours: number;
  nextFundingAt: number; // Unix ms
  readAt: number; // Unix ms of the reply
};

export class GeminiAnchorPoller extends AnchorPoller {
  // The base constructor has set venue by the time this initialiser runs.
  protected readonly intervalMs = Math.max(
    MIN_INTERVAL_MS,
    Math.ceil((this.venue.markets.length * 60_000) / RISKSTATS_PER_MINUTE),
  );

  private readonly funding = new Map<string, FundingReading>(); // by rawMarketId
  // The refresh picks by last request rather than by reading age, so a market whose call keeps failing cannot starve the rest.
  private readonly fundingTriedAt = new Map<string, number>(); // Unix ms
  private fundingInFlight = false;

  protected async fetchRound(
    _ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const markets = this.venue.markets;
    const results = await Promise.allSettled(
      markets.map((m) => this.readRiskStats(m.rawMarketId, signal)),
    );

    const rows: AnchorMap = new Map();
    let firstError: unknown;
    let fulfilled = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        firstError ??= result.reason;
        continue;
      }

      fulfilled++;
      const rawMarketId = markets[i].rawMarketId;
      const { stats, arrivedAt } = result.value;
      const funding = this.funding.get(rawMarketId);

      // For 10 to 20 s after each hour the reply still names the settlement that just passed.
      if (funding === undefined || funding.nextFundingAt <= arrivedAt) {
        continue;
      }

      const mark = Number(stats.mark_price);
      rows.set(rawMarketId, {
        index: Number(stats.index_price),
        mark,
        fundingRate: funding.amount / mark,
        fundingIntervalHours: funding.intervalHours,
        nextFundingAt: funding.nextFundingAt,
        ts: arrivedAt,
      });
    }

    // Rethrown so a 429 on every request still pauses the poller.
    if (fulfilled === 0) {
      throw firstError;
    }

    this.refreshFunding(signal);

    return rows;
  }

  private async readRiskStats(rawMarketId: string, signal: AbortSignal) {
    const stats = await this.getJson<GeminiRiskStats>(
      `${RISKSTATS_URL}${rawMarketId}`,
      signal,
    );

    return { stats, arrivedAt: Date.now() };
  }

  // A funding reply took 1.2 to 3.8 s, so it runs beside the rounds and is never awaited, one request at a time.
  private refreshFunding(signal: AbortSignal): void {
    if (this.fundingInFlight) {
      return;
    }

    const now = Date.now();
    let chosen: string | undefined;
    let chosenTriedAt = Infinity;

    for (const market of this.venue.markets) {
      const rawMarketId = market.rawMarketId;
      const reading = this.funding.get(rawMarketId);

      if (
        reading !== undefined &&
        now - reading.readAt <= FUNDING_MAX_AGE_MS &&
        reading.nextFundingAt > now
      ) {
        continue;
      }

      const triedAt = this.fundingTriedAt.get(rawMarketId) ?? 0;
      if (triedAt < chosenTriedAt) {
        chosen = rawMarketId;
        chosenTriedAt = triedAt;
      }
    }

    if (chosen !== undefined) {
      this.fundingTriedAt.set(chosen, now);
      void this.readFunding(chosen, signal);
    }
  }

  private async readFunding(
    rawMarketId: string,
    signal: AbortSignal,
  ): Promise<void> {
    this.fundingInFlight = true;

    try {
      const reply = await this.getJson<GeminiFundingAmount>(
        `${FUNDING_URL}${rawMarketId}`,
        signal,
      );

      this.funding.set(rawMarketId, {
        amount: reply.estimatedFundingAmount,
        // No interval field exists, and the gap between the two settlement times is the interval.
        intervalHours:
          (reply.nextFundingTimestamp - reply.fundingTimestampMilliSecs) /
          HOUR_MS,
        nextFundingAt: reply.nextFundingTimestamp,
        readAt: Date.now(),
      });
    } catch (e) {
      if (!signal.aborted) {
        this.logger.warn(
          `funding read for ${rawMarketId} failed: ${(e as Error).message}`,
        );
      }
    } finally {
      this.fundingInFlight = false;
    }
  }
}
