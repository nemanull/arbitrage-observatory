import type { AnchorRows } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { BinanceFundingInfo, BinancePremiumIndex } from './types';

// USD-M and COIN-M publish the same shape on two hosts, and one call without a symbol returns every contract.
const USD_M_PREMIUM_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex';
const COIN_M_PREMIUM_URL = 'https://dapi.binance.com/dapi/v1/premiumIndex';

// The interval per symbol lives in a separate call, and COIN-M answers it with an empty array, so COIN-M keeps the documented default.
const USD_M_FUNDING_INFO_URL = 'https://fapi.binance.com/fapi/v1/fundingInfo';
const DEFAULT_INTERVAL_HOURS = 8;

// Intervals change on a schedule the venue announces, which SOPH did on 2026-09-08, so the table is reread every hour.
const FUNDING_INFO_REFRESH_MS = 60 * 60 * 1000;

export class BinanceAnchorPoller extends AnchorPoller {
  private readonly intervalHours = new Map<string, number>();
  private intervalsReadAt = 0; // Unix ms, 0 = never, so the first round reads the table

  protected async fetchRound(
    ts: number,
    signal: AbortSignal,
  ): Promise<AnchorRows> {
    if (ts - this.intervalsReadAt >= FUNDING_INFO_REFRESH_MS) {
      await this.readIntervals(signal);
      this.intervalsReadAt = ts;
    }

    const hosts = this.hosts();
    const replies = await Promise.all(
      hosts.map((url) => this.getJson<BinancePremiumIndex[]>(url, signal)),
    );

    const rows: AnchorRows = new Map();
    for (const reply of replies) {
      for (const row of reply) {
        rows.set(row.symbol, {
          index: Number(row.indexPrice),
          mark: Number(row.markPrice),
          fundingRate: Number(row.lastFundingRate),
          fundingIntervalHours:
            this.intervalHours.get(row.symbol) ?? DEFAULT_INTERVAL_HOURS,
          nextFundingAt: row.nextFundingTime,
        });
      }
    }

    return rows;
  }

  // A failure here fails the round, and intervalsReadAt stays where it was, so the next round tries again.
  private async readIntervals(signal: AbortSignal): Promise<void> {
    const info = await this.getJson<BinanceFundingInfo[]>(
      USD_M_FUNDING_INFO_URL,
      signal,
    );

    this.intervalHours.clear();
    for (const row of info) {
      this.intervalHours.set(row.symbol, row.fundingIntervalHours);
    }

    this.logger.log(
      `funding intervals for ${this.intervalHours.size} symbol(s)`,
    );
  }

  private hosts(): string[] {
    const urls: string[] = [];
    if (this.venue.markets.some((m) => m.linear)) {
      urls.push(USD_M_PREMIUM_URL);
    }
    if (this.venue.markets.some((m) => !m.linear)) {
      urls.push(COIN_M_PREMIUM_URL);
    }
    return urls;
  }
}
