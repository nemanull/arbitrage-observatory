import type { AnchorMap, AnchorRow } from '../../feeds/anchor/types';
import { AnchorPoller } from '../../feeds/anchor/AnchorPoller';
import type { BitgetFundingRate, BitgetReply, BitgetTicker } from './types';

// Two classic v2 calls per product type answer for every contract at once.
// The tickers carry index and mark, and the funding call carries rate, interval and next settlement.
const TICKERS_URL =
  'https://api.bitget.com/api/v2/mix/market/tickers?productType=';
const FUNDING_URL =
  'https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=';

// USDC-M contracts sit under their own product type, so their pair of calls runs only while one of them is tracked.
const PRODUCT_TYPES = new Map([
  ['USDT', 'USDT-FUTURES'],
  ['USDC', 'USDC-FUTURES'],
]);

const SUCCESS_CODE = '00000';

export class BitgetAnchorPoller extends AnchorPoller {
  protected async fetchRound(
    _ts: number,
    signal: AbortSignal,
  ): Promise<AnchorMap> {
    const replies = await Promise.all(
      this.productTypes().map((productType) =>
        Promise.all([
          this.getJson<BitgetReply<BitgetTicker>>(
            TICKERS_URL + productType,
            signal,
          ),
          this.getJson<BitgetReply<BitgetFundingRate>>(
            FUNDING_URL + productType,
            signal,
          ),
        ]),
      ),
    );

    const rows: AnchorMap = new Map();
    for (const [tickers, funding] of replies) {
      checkCode(tickers, 'tickers');
      checkCode(funding, 'current-fund-rate');

      const tickerOf = new Map<string, BitgetTicker>();
      for (const ticker of tickers.data) {
        tickerOf.set(ticker.symbol, ticker);
      }

      // The funding call also lists pre-listing and test symbols with no ticker row, and those fall out on the join.
      for (const f of funding.data) {
        const ticker = tickerOf.get(f.symbol);
        if (ticker !== undefined) {
          rows.set(f.symbol, toRow(ticker, f));
        }
      }
    }

    return rows;
  }

  private productTypes(): string[] {
    const types: string[] = [];
    for (const [quote, productType] of PRODUCT_TYPES) {
      if (this.venue.markets.some((m) => m.quote === quote)) {
        types.push(productType);
      }
    }
    return types;
  }
}

// Rate and next settlement come from the same reply, because at a settlement the tickers rate trailed the funding call by a poll.
function toRow(t: BitgetTicker, f: BitgetFundingRate): AnchorRow {
  return {
    index: Number(t.indexPrice),
    mark: Number(t.markPrice),
    fundingRate: Number(f.fundingRate),
    fundingIntervalHours: Number(f.fundingRateInterval),
    nextFundingAt: Number(f.nextUpdate),
  };
}

function checkCode(reply: BitgetReply<unknown>, call: string): void {
  if (reply.code !== SUCCESS_CODE) {
    throw new Error(`${call} code ${reply.code}: ${reply.msg}`);
  }
}
