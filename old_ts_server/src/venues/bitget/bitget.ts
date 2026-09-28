import type { BookLevel, Market } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { chunk } from '../../feeds/book/shared';
import { VenueFeed } from '../../feeds/book/VenueFeed';
import type {
  BitgetBookLevel,
  BitgetBooksData,
  BitgetStreamFrame,
} from './types';

// The unified account socket pushes `books` every 50 to 65 ms, where the classic v2 socket pushes every 100 ms.
// It spells USDT-M and USDC-M ids exactly as CCXT does.
const PUBLIC_URL = 'wss://ws.bitget.com/v3/ws/public';

// A snapshot of up to 1,000 levels a side, then updates chained by pseq.
const TOPIC = 'books';

// A real symbol under the wrong instType is acknowledged and then silent, so the family comes from the market's quote and is never guessed.
const INST_TYPES = new Map([
  ['USDT', 'usdt-futures'],
  ['USDC', 'usdc-futures'],
]);

// Bitget recommends staying under 50 channels per connection, and documents a cap of 1,000.
const MARKETS_PER_CONNECTION = 50;

// A v3 frame of 25 or more arguments closed the socket with no error on 2026-09-15.
// Frames of 10 sent a second apart carried 150 channels with no gap.
const ARGS_PER_FRAME = 10;
const SUBSCRIBE_GAP_MS = 1_000;

// Bitget allows 300 connection attempts per IP per 5 minutes.
const CONNECT_STAGGER_MS = 1_000;

// A quiet book can be silent for seconds, so the pong is what proves the socket alive.
// The server closes a socket that sends no ping for 2 minutes, even while it streams data to it.
const MAX_SILENCE_MS = 60_000;
const PING_INTERVAL_MS = 25_000;

const PING_FRAME = 'ping';
const PONG_FRAME = 'pong';

export class BitgetFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  protected readonly connectStaggerMs = CONNECT_STAGGER_MS;
  protected readonly subscribeGapMs = SUBSCRIBE_GAP_MS;
  private readonly lastSeq = new Map<string, number>(); // `seq` of the last frame applied, per symbol

  protected planEndpoints(): EndpointPlan[] {
    const plans: EndpointPlan[] = [];

    for (const [quote, instType] of INST_TYPES) {
      const markets = this.venue.markets.filter((m) => m.quote === quote);
      chunk(markets, MARKETS_PER_CONNECTION).forEach((slice, i) => {
        plans.push({
          id: `${this.venue.id}#${instType}#${i}`,
          url: PUBLIC_URL,
          markets: slice,
        });
      });
    }

    const unplanned = this.venue.markets.filter(
      (m) => !INST_TYPES.has(m.quote),
    );
    if (unplanned.length > 0) {
      this.logger.error(
        `left out ${unplanned.length} market(s) whose quote names no instType, first ${unplanned[0].rawMarketId}`,
      );
    }

    return plans;
  }

  protected getSubscribeFrames(markets: Market[]): object[] {
    return chunk(markets, ARGS_PER_FRAME).map((slice) => ({
      op: 'subscribe',
      args: slice.map((m) => ({
        instType: INST_TYPES.get(m.quote),
        topic: TOPIC,
        symbol: m.rawMarketId,
      })),
    }));
  }

  protected startKeepalive(c: SingleSocketConnection): void {
    const ping = setInterval(() => {
      if (c.socket.readyState === c.socket.OPEN) {
        c.socket.send(PING_FRAME);
      }
    }, PING_INTERVAL_MS);

    ping.unref();
    c.timers.push(ping);
  }

  protected handleMessage(raw: Buffer, c: SingleSocketConnection): void {
    const text = raw.toString('utf8');

    if (text === PONG_FRAME) {
      return;
    }

    const frame = JSON.parse(text) as BitgetStreamFrame;
    const data = frame.data?.[0];
    if (frame.arg?.topic === TOPIC && data !== undefined) {
      this.applyBook(frame.arg.symbol, frame.action, data, c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private applyBook(
    symbol: string,
    action: string | undefined,
    data: BitgetBooksData,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, symbol)) {
      return;
    }

    const bids = data.b.map(toLevel);
    const asks = data.a.map(toLevel);

    if (action === 'snapshot') {
      this.lastSeq.set(symbol, data.seq);
      this.resetBook(symbol, bids, asks);
      return;
    }

    const book = this.bookOf(symbol);
    const last = this.lastSeq.get(symbol);

    if (book === undefined || last === undefined) {
      this.resync(c, symbol, 'update_before_snapshot');
      return;
    }

    // A restart on the venue side may begin a new chain at pseq 0, and only a fresh snapshot rebuilds the book.
    if (data.pseq === 0) {
      this.resync(c, symbol, 'sequence_reset', { seq: data.seq });
      return;
    }

    if (data.pseq !== last) {
      this.resync(c, symbol, 'sequence_gap', {
        expected: last,
        got: data.pseq,
        seq: data.seq,
      });
      return;
    }

    this.lastSeq.set(symbol, data.seq);

    for (let i = 0; i < bids.length; i++) {
      book.setBid(bids[i][0], bids[i][1]);
    }

    for (let i = 0; i < asks.length; i++) {
      book.setAsk(asks[i][0], asks[i][1]);
    }

    this.publish(symbol, book);
  }

  private handleControlFrame(
    frame: BitgetStreamFrame,
    c: SingleSocketConnection,
  ): void {
    if (frame.event === 'error') {
      this.logger.error(`${c.id}: error ${frame.code}: ${frame.msg}`);
    }
  }
}

function toLevel(level: BitgetBookLevel): BookLevel {
  return [Number(level[0]), Number(level[1])];
}
