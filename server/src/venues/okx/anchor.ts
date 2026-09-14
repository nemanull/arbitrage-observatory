import type { Market } from '../../engine/cluster/types';
import type { AnchorRow, AnchorMap } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type {
  OkxFundingRate,
  OkxIndexTicker,
  OkxInstrument,
  OkxMarkPrice,
  OkxReply,
} from './types';

// OKX spreads the three numbers over three endpoints, and each answers for every instrument in one call.
const FUNDING_URL = 'https://www.okx.com/api/v5/public/funding-rate?instId=ANY';
const MARK_URL = 'https://www.okx.com/api/v5/public/mark-price?instType=SWAP';
const INDEX_URL = 'https://www.okx.com/api/v5/market/index-tickers?quoteCcy=';
const INSTRUMENTS_URL =
  'https://www.okx.com/api/v5/public/instruments?instType=SWAP';

// The index is keyed by its own id, BTC-USDT for BTC-USDT-SWAP and BTC-USD for BTC-USD-SWAP, which the instrument's uly field names.
// Listings change, so the table is reread every hour.
const INSTRUMENTS_REFRESH_MS = 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

export class OkxAnchorPoller extends AnchorPoller {
  private readonly indexIdOf = new Map<string, string>(); // instId to uly
  private quoteCcys: string[] = [];
  private instrumentsReadAt = 0; // Unix ms, 0 = never, so the first round reads the table

  protected async fetchRound(
    ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    if (ts - this.instrumentsReadAt >= INSTRUMENTS_REFRESH_MS) {
      await this.readInstruments(signal);
      this.instrumentsReadAt = ts;
    }

    const [funding, mark, ...indices] = await Promise.all([
      this.getJson<OkxReply<OkxFundingRate>>(FUNDING_URL, signal),
      this.getJson<OkxReply<OkxMarkPrice>>(MARK_URL, signal),
      ...this.quoteCcys.map((quote) =>
        this.getJson<OkxReply<OkxIndexTicker>>(INDEX_URL + quote, signal),
      ),
    ]);
    checkCode(funding, 'funding-rate');
    checkCode(mark, 'mark-price');

    const indexPx = new Map<string, number>();
    for (const reply of indices) {
      checkCode(reply, 'index-tickers');
      for (const row of reply.data) {
        indexPx.set(row.instId, Number(row.idxPx));
      }
    }

    const markPx = new Map<string, number>();
    for (const row of mark.data) {
      markPx.set(row.instId, Number(row.markPx));
    }

    const rows: AnchorMap = new Map();
    for (const f of funding.data) {
      const row = toRow(f, markPx, indexPx, this.indexIdOf);
      if (row !== null) {
        rows.set(f.instId, row);
      }
    }

    return rows;
  }

  // A failure here fails the round, and instrumentsReadAt stays where it was, so the next round tries again.
  private async readInstruments(signal: AbortSignal): Promise<void> {
    const reply = await this.getJson<OkxReply<OkxInstrument>>(
      INSTRUMENTS_URL,
      signal,
    );
    checkCode(reply, 'instruments');

    this.indexIdOf.clear();
    const quotes = new Set<string>();
    for (const inst of reply.data) {
      this.indexIdOf.set(inst.instId, inst.uly);
      quotes.add(inst.uly.slice(inst.uly.indexOf('-') + 1));
    }

    this.quoteCcys = [...quotes].filter((quote) =>
      this.venue.markets.some((m) => quoteOf(m, this.indexIdOf) === quote),
    );

    this.logger.log(
      `${this.indexIdOf.size} instrument(s), index quotes ${this.quoteCcys.join(', ')}`,
    );
  }
}

// The funding reply also lists the tradfi instruments that are not swaps, and those have no mark row here, so they fall out on the join.
function toRow(
  f: OkxFundingRate,
  markPx: Map<string, number>,
  indexPx: Map<string, number>,
  indexIdOf: Map<string, string>,
): AnchorRow | null {
  const mark = markPx.get(f.instId);
  const indexId = indexIdOf.get(f.instId);
  const index = indexId === undefined ? undefined : indexPx.get(indexId);

  if (mark === undefined || index === undefined) {
    return null;
  }

  const fundingTime = Number(f.fundingTime);
  const nextFundingTime = Number(f.nextFundingTime);

  return {
    index,
    mark,
    fundingRate: Number(f.fundingRate),
    // No interval field exists, and the gap between the two settlement times is the interval.
    fundingIntervalHours: (nextFundingTime - fundingTime) / HOUR_MS,
    nextFundingAt: fundingTime,
  };
}

function quoteOf(market: Market, indexIdOf: Map<string, string>): string {
  const uly = indexIdOf.get(market.rawMarketId);
  return uly === undefined ? market.quote : uly.slice(uly.indexOf('-') + 1);
}

function checkCode(reply: OkxReply<unknown>, call: string): void {
  if (reply.code !== '0') {
    throw new Error(`${call} code ${reply.code}: ${reply.msg}`);
  }
}
