import type { BookLevel, Market } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { chunk } from '../../ws/shared';
import { VenueFeed } from '../../ws/VenueFeed';
import type {
  BybitOrderbookData,
  BybitOrderbookLevel,
  BybitStreamFrame,
} from './types';

// Bybit splits its public endpoints by market family, and one connection cannot carry topics from two families.
const LINEAR_URL = 'wss://stream.bybit.com/v5/public/linear';
const INVERSE_URL = 'wss://stream.bybit.com/v5/public/inverse';

// Fifty levels at a 20 ms push, snapshot then deltas. The next depth up is 200 levels at 100 ms.
const DEPTH = 50;

// Bybit caps the cumulative public argument string at 21,000 characters per connection, and a 200 topic slice of `orderbook.50.` topics measures about 4,900.
// It also allows 1,000 concurrent connections per family, so more and smaller sockets cost nothing.
const MARKETS_PER_CONNECTION = 200;

// A full slice fits in one frame.
// The chunk is what keeps the frame inside the character cap if the slice size ever grows.
const TOPICS_PER_FRAME = 200;

// The application ping below is answered every 20 seconds, so three missed answers is a dead socket.
const MAX_SILENCE_MS = 60_000;
const PING_INTERVAL_MS = 20_000;

export class BybitFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  private readonly lastUpdateId = new Map<string, number>(); // `u` of the last frame applied, per symbol

  protected planEndpoints(): EndpointPlan[] {
    const linear: Market[] = [];
    const inverse: Market[] = [];
    for (const market of this.venue.markets) {
      (market.linear ? linear : inverse).push(market);
    }

    return [
      ...this.planFamily(linear, 'linear', LINEAR_URL),
      ...this.planFamily(inverse, 'inverse', INVERSE_URL),
    ];
  }

  private planFamily(
    markets: Market[],
    family: string,
    url: string,
  ): EndpointPlan[] {
    return chunk(markets, MARKETS_PER_CONNECTION).map((slice, i) => ({
      id: `${this.venue.id}#${family}#${i}`,
      url,
      markets: slice,
    }));
  }

  protected getSubscribeFrames(markets: Market[]): object[] {
    return chunk(markets, TOPICS_PER_FRAME).map((slice, i) => ({
      req_id: `sub-${i + 1}`,
      op: 'subscribe',
      args: slice.map(topicName),
    }));
  }

  protected startKeepalive(c: SingleSocketConnection): void {
    const ping = setInterval(() => {
      if (c.socket.readyState === c.socket.OPEN) {
        c.socket.send(JSON.stringify({ op: 'ping' }));
      }
    }, PING_INTERVAL_MS);

    ping.unref();
    c.timers.push(ping);
  }

  protected handleMessage(raw: Buffer, c: SingleSocketConnection): void {
    const frame = JSON.parse(raw.toString('utf8')) as BybitStreamFrame;
    const data = frame.data;

    if (
      data !== undefined &&
      typeof data.s === 'string' &&
      frame.topic?.startsWith('orderbook.')
    ) {
      this.applyBook(data.s, frame.type, data, c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private applyBook(
    symbol: string,
    type: string | undefined,
    data: Partial<BybitOrderbookData>,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, symbol)) {
      return;
    }

    const bids = (data.b ?? []).map(toLevel);
    const asks = (data.a ?? []).map(toLevel);

    if (type === 'snapshot') {
      this.lastUpdateId.set(symbol, data.u ?? 0);
      this.resetBook(symbol, bids, asks);
      return;
    }

    const book = this.bookOf(symbol);
    const last = this.lastUpdateId.get(symbol);

    if (book === undefined || last === undefined) {
      this.resync(c, symbol, 'delta_before_snapshot');
      return;
    }

    if (data.u !== last + 1) {
      this.resync(c, symbol, 'sequence_gap', {
        expected: last + 1,
        got: data.u,
      });
      return;
    }

    this.lastUpdateId.set(symbol, data.u);

    for (let i = 0; i < bids.length; i++) {
      book.setBid(bids[i][0], bids[i][1]);
    }

    for (let i = 0; i < asks.length; i++) {
      book.setAsk(asks[i][0], asks[i][1]);
    }

    this.publish(symbol, book);
  }

  private handleControlFrame(
    frame: BybitStreamFrame,
    c: SingleSocketConnection,
  ): void {
    if (frame.success === false) {
      this.logger.error(
        `${c.id}: ${frame.op ?? 'request'} rejected: ${frame.ret_msg ?? ''}`,
      );
    }
  }
}

function toLevel(level: BybitOrderbookLevel): BookLevel {
  return [Number(level[0]), Number(level[1])];
}

function topicName(market: Market): string {
  return `orderbook.${DEPTH}.${market.rawMarketId}`;
}
