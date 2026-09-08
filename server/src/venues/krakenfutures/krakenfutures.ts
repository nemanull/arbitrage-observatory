import type { BookLevel, Market } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { chunk } from '../../ws/shared';
import { VenueFeed } from '../../ws/VenueFeed';
import type {
  KrakenBookDelta,
  KrakenBookLevel,
  KrakenBookSnapshot,
  KrakenFuturesFrame,
} from './types';

const PUBLIC_URL = 'wss://futures.kraken.com/ws/v1';

// The whole book on subscribe, then one level per delta. Kraken has no depth parameter and does not compress.
const FEED = 'book';
const SNAPSHOT_FEED = 'book_snapshot';

// Kraken allows 200 symbols per connection.
const MARKETS_PER_CONNECTION = 100;
const PRODUCTS_PER_FRAME = 100;

const MAX_SILENCE_MS = 30_000;

// Kraken documents a 60 second ping requirement and does not enforce it, so this keeps a threefold margin.
const PING_INTERVAL_MS = 20_000;

export class KrakenFuturesFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  private readonly lastSeq = new Map<string, number>(); // `seq` of the last frame applied, per product

  protected planEndpoints(): EndpointPlan[] {
    return chunk(this.venue.markets, MARKETS_PER_CONNECTION).map(
      (slice, i) => ({
        id: `${this.venue.id}#swap#${i}`,
        url: PUBLIC_URL,
        markets: slice,
      }),
    );
  }

  // Kraken names the feed once and passes the symbols as an array, where every other venue repeats the channel per symbol.
  protected getSubscribeFrames(markets: Market[]): object[] {
    return chunk(markets, PRODUCTS_PER_FRAME).map((slice) => ({
      event: 'subscribe',
      feed: FEED,
      product_ids: slice.map((m) => m.rawMarketId),
    }));
  }

  protected startKeepalive(c: SingleSocketConnection): void {
    const ping = setInterval(() => {
      if (c.socket.readyState === c.socket.OPEN) {
        c.socket.ping();
      }
    }, PING_INTERVAL_MS);

    ping.unref();
    c.timers.push(ping);
  }

  protected handleMessage(raw: Buffer, c: SingleSocketConnection): void {
    const frame = JSON.parse(raw.toString('utf8')) as KrakenFuturesFrame;

    if (typeof frame.product_id === 'string') {
      if (frame.feed === SNAPSHOT_FEED) {
        this.applySnapshot(frame as KrakenBookSnapshot, c);
        return;
      }

      if (frame.feed === FEED) {
        this.applyDelta(frame as KrakenBookDelta, c);
        return;
      }
    }

    this.handleControlFrame(frame, c);
  }

  private applySnapshot(
    snapshot: KrakenBookSnapshot,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, snapshot.product_id)) {
      return;
    }

    this.lastSeq.set(snapshot.product_id, snapshot.seq);
    this.resetBook(
      snapshot.product_id,
      (snapshot.bids ?? []).map(toLevel),
      (snapshot.asks ?? []).map(toLevel),
    );
  }

  private applyDelta(delta: KrakenBookDelta, c: SingleSocketConnection): void {
    const productId = delta.product_id;

    if (!this.accepts(c, productId)) {
      return;
    }

    const book = this.bookOf(productId);
    const last = this.lastSeq.get(productId);

    if (book === undefined || last === undefined) {
      this.resync(c, productId, 'delta_before_snapshot');
      return;
    }

    if (delta.seq !== last + 1) {
      this.resync(c, productId, 'sequence_gap', {
        expected: last + 1,
        got: delta.seq,
      });
      return;
    }

    this.lastSeq.set(productId, delta.seq);

    if (delta.side === 'buy') {
      book.setBid(delta.price, delta.qty);
    } else {
      book.setAsk(delta.price, delta.qty);
    }

    this.publish(productId, book);
  }

  private handleControlFrame(
    frame: KrakenFuturesFrame,
    c: SingleSocketConnection,
  ): void {
    if (frame.event === 'alert') {
      this.logger.error(`${c.id}: ${frame.message ?? 'alert'}`);
    }
  }
}

function toLevel(level: KrakenBookLevel): BookLevel {
  return [level.price, level.qty];
}
