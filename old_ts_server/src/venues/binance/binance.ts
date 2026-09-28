import type { BookLevel, Market } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { chunk } from '../../feeds/book/shared';
import { VenueFeed } from '../../feeds/book/VenueFeed';
import type {
  BinanceDepthLevel,
  BinanceDepthUpdate,
  BinanceStreamFrame,
} from './types';

// Binance routes book data to its own host and path.
// Trades, mark price, and funding live on /market/ws, which a book feed never needs.
// The combined /stream endpoint is what names the channel on every frame, and a diff and a snapshot are identical without that name.
const USD_M_BOOK_URL = 'wss://fstream.binance.com/public/stream';
const COIN_M_BOOK_URL = 'wss://dstream.binance.com/stream';

// Changes as they happen, about one frame per 30 ms on a busy market.
const DIFF_SUFFIX = '@depth@0ms';

// The periodic truth the diffs are reseeded from, and the only source of the window the diffs may write inside.
// Its level count must stay at or above Engine.depthLevels.
const SNAPSHOT_SUFFIX = '@depth20@100ms';

// USD-M allows 1024 streams per connection and COIN-M publishes no limit at all. Two streams per market is 400 here
const MARKETS_PER_CONNECTION = 200;
const STREAMS_PER_FRAME = 100;
const MAX_SILENCE_MS = 240_000;

// Binance answers our ping, but the point of sending one is the write itself.
const CLIENT_PING_INTERVAL_MS = 30_000;

// Binance closes every socket at the 24 hour mark with no in-band warning.
const CONNECTION_REFRESH_MS = 23 * 60 * 60 * 1000;
const CONNECTION_REFRESH_JITTER_MS = 30 * 60 * 1000;

type SymbolState = {
  lastUpdateId: number; // `u` of the last frame applied
  lowestBid: number; // deepest bid price the last snapshot covered
  highestAsk: number; // deepest ask price the last snapshot covered
};

// Both channels send this shape. A frame missing any of it is not a book frame.
type DepthFrame = Required<
  Pick<BinanceDepthUpdate, 's' | 'U' | 'u' | 'pu' | 'b' | 'a'>
>;

export class BinanceFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  private readonly states = new Map<string, SymbolState>();

  protected planEndpoints(): EndpointPlan[] {
    const linear: Market[] = [];
    const inverse: Market[] = [];
    for (const market of this.venue.markets) {
      (market.linear ? linear : inverse).push(market);
    }

    return [
      ...this.planFamily(linear, 'linear', USD_M_BOOK_URL),
      ...this.planFamily(inverse, 'inverse', COIN_M_BOOK_URL),
    ];
  }

  private planFamily(
    markets: Market[],
    family: string,
    baseUrl: string,
  ): EndpointPlan[] {
    return chunk(markets, MARKETS_PER_CONNECTION).map((slice, i) => ({
      id: `${this.venue.id}#${family}#${i}`,
      url: `${baseUrl}?streams=${streamNames(slice[0]).join('/')}`,
      markets: slice,
    }));
  }

  protected getSubscribeFrames(markets: Market[]): object[] {
    return chunk(markets.flatMap(streamNames), STREAMS_PER_FRAME).map(
      (params, i) => ({
        method: 'SUBSCRIBE',
        params,
        id: i + 1,
      }),
    );
  }

  protected startKeepalive(c: SingleSocketConnection): void {
    const ping = setInterval(() => {
      if (c.socket.readyState === c.socket.OPEN) {
        c.socket.ping();
      }
    }, CLIENT_PING_INTERVAL_MS);

    const refresh = setTimeout(
      () => {
        this.logger.log(`${c.id}: retiring the socket before the 24h cap`);
        this.closeConnection(c, true);
      },
      CONNECTION_REFRESH_MS + Math.random() * CONNECTION_REFRESH_JITTER_MS,
    );

    ping.unref();
    refresh.unref();
    c.timers.push(ping, refresh);
  }

  protected handleMessage(raw: Buffer, c: SingleSocketConnection): void {
    const frame = JSON.parse(raw.toString('utf8')) as BinanceStreamFrame;
    const event = frame.data ?? frame;

    if (isDepthFrame(event)) {
      if (frame.stream?.endsWith(DIFF_SUFFIX)) {
        this.applyDiff(event, c);
      } else {
        this.applySnapshot(event, c);
      }
      return;
    }

    this.handleControlFrame(frame, c);
  }

  // The snapshot is the only frame that may widen the window, so it sets both bounds from its own deepest level.
  private applySnapshot(event: DepthFrame, c: SingleSocketConnection): void {
    const symbol = event.s;

    if (!this.accepts(c, symbol)) {
      return;
    }

    const state = this.states.get(symbol);

    // The diffs already carry this state, and rewinding to it would drop every level they added since.
    if (state !== undefined && event.u <= state.lastUpdateId) {
      return;
    }

    const bids = event.b.map(toLevel);
    const asks = event.a.map(toLevel);

    this.states.set(symbol, {
      lastUpdateId: event.u,
      lowestBid: bids.length > 0 ? bids[bids.length - 1][0] : 0,
      highestAsk: asks.length > 0 ? asks[asks.length - 1][0] : Infinity,
    });

    this.resetBook(symbol, bids, asks);
  }

  private applyDiff(event: DepthFrame, c: SingleSocketConnection): void {
    const symbol = event.s;

    if (!this.accepts(c, symbol)) {
      return;
    }

    const state = this.states.get(symbol);
    const book = this.bookOf(symbol);

    // Unsynced. The next snapshot is at most one snapshot interval away and reseeds the symbol on its own.
    if (state === undefined || book === undefined) {
      return;
    }

    if (event.u <= state.lastUpdateId) {
      return;
    }

    // A diff either chains onto the last id or straddles it, which is how the first diff after a snapshot arrives.
    if (event.pu !== state.lastUpdateId && event.U > state.lastUpdateId + 1) {
      this.states.delete(symbol);
      this.logger.warn({
        event: 'book_desync',
        connection: c.id,
        rawMarketId: symbol,
        reason: 'sequence_gap',
        expected: state.lastUpdateId,
        firstUpdateId: event.U,
        previousUpdateId: event.pu,
      });
      return;
    }

    const bids = event.b.map(toLevel);
    const asks = event.a.map(toLevel);

    // Outside the window the book holds no levels, so writing there would put a level of rank 21 or worse inside a top 20 reading.
    for (let i = 0; i < bids.length; i++) {
      if (bids[i][0] >= state.lowestBid) {
        book.setBid(bids[i][0], bids[i][1]);
      }
    }

    for (let i = 0; i < asks.length; i++) {
      if (asks[i][0] <= state.highestAsk) {
        book.setAsk(asks[i][0], asks[i][1]);
      }
    }

    // Emptying a side inside the window says the window ran out, not that the venue withdrew the side.
    // The truth is one snapshot away, and a real one sided book still reaches the engine through applySnapshot.
    if (book.bidCount === 0 || book.askCount === 0) {
      this.states.delete(symbol);
      return;
    }

    state.lastUpdateId = event.u;
    this.publish(symbol, book);
  }

  private handleControlFrame(
    frame: BinanceStreamFrame,
    c: SingleSocketConnection,
  ): void {
    if (frame.error) {
      this.logger.error(
        `${c.id}: subscribe rejected (${frame.error.code}): ${frame.error.msg}`,
      );
    } else if (frame.id !== undefined) {
      this.logger.debug(`${c.id}: subscribe frame ${frame.id} acknowledged`);
    }
  }
}

function isDepthFrame(event: Partial<BinanceDepthUpdate>): event is DepthFrame {
  return (
    event.e === 'depthUpdate' &&
    typeof event.s === 'string' &&
    typeof event.U === 'number' &&
    typeof event.u === 'number' &&
    typeof event.pu === 'number' &&
    Array.isArray(event.b) &&
    Array.isArray(event.a)
  );
}

function toLevel(level: BinanceDepthLevel): BookLevel {
  return [Number(level[0]), Number(level[1])];
}

function streamNames(market: Market): string[] {
  const symbol = market.rawMarketId.toLowerCase();

  return [`${symbol}${DIFF_SUFFIX}`, `${symbol}${SNAPSHOT_SUFFIX}`];
}
