import type { BookLevel, Market } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { chunk } from '../../feeds/book/shared';
import { VenueFeed } from '../../feeds/book/VenueFeed';
import type { CoinbaseEvent, CoinbaseFrame, CoinbaseL2Update } from './types';

// Coinbase Advanced serves the perpetual books without credentials, and the anchor poller reads the International Exchange REST list for the index and the mark, see anchor.ts.
// The International Exchange socket closes every connection from this host with code 3003 before it reads a subscribe frame.
const PUBLIC_URL = 'wss://advanced-trade-ws.coinbase.com';

const LEVEL2_CHANNEL = 'level2'; // what we subscribe
const L2_DATA_CHANNEL = 'l2_data'; // what the data frames say
const HEARTBEATS_CHANNEL = 'heartbeats';
const SUBSCRIPTIONS_CHANNEL = 'subscriptions';

// level2 refuses more than about 30 products per connection with "too many L2 streams requested in a single session".
const MARKETS_PER_CONNECTION = 30;
const PRODUCTS_PER_FRAME = 30;

// Coinbase allows 8 client messages a second per IP, and every connection sends two subscribe frames.
const CONNECT_STAGGER_MS = 300;
const RECONNECT_JITTER_MS = 1_500;

const MAX_SILENCE_MS = 15_000;

const MISSING_SAMPLE = 3;

export class CoinbaseFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  protected readonly connectStaggerMs = CONNECT_STAGGER_MS;
  protected readonly reconnectJitterMs = RECONNECT_JITTER_MS;
  private readonly lastSequence = new WeakMap<SingleSocketConnection, number>();

  protected planEndpoints(): EndpointPlan[] {
    return chunk(this.venue.markets, MARKETS_PER_CONNECTION).map(
      (slice, i) => ({
        id: `${this.venue.id}#swap#${i}`,
        url: PUBLIC_URL,
        markets: slice,
      }),
    );
  }

  // The level2 frame goes first on purpose.
  // Every acknowledgement lists the connection's whole subscription set, and checkSubscriptions reads its level2 list.
  // Subscribing heartbeats first would produce one acknowledgement with no level2 key, which reads as every product having been rejected.
  protected getSubscribeFrames(markets: Market[]): object[] {
    const frames: object[] = chunk(markets, PRODUCTS_PER_FRAME).map(
      (slice) => ({
        type: 'subscribe',
        channel: LEVEL2_CHANNEL,
        product_ids: slice.map((m) => m.rawMarketId),
      }),
    );

    frames.push({ type: 'subscribe', channel: HEARTBEATS_CHANNEL });

    return frames;
  }

  // The heartbeats subscription is the keepalive, and it's also what stops a quiet product's subscription from being closed
  protected startKeepalive(): void {}

  protected handleMessage(raw: Buffer, c: SingleSocketConnection): void {
    const frame = JSON.parse(raw.toString('utf8')) as CoinbaseFrame;

    if (
      typeof frame.sequence_num === 'number' &&
      !this.checkSequence(frame.sequence_num, c)
    ) {
      return;
    }

    switch (frame.channel) {
      case L2_DATA_CHANNEL:
        this.applyEvents(frame.events ?? [], c);
        return;
      case HEARTBEATS_CHANNEL:
        return;
      case SUBSCRIPTIONS_CHANNEL:
        this.checkSubscriptions(frame, c);
        return;
    }

    if (frame.type === 'error') {
      this.logger.error(`${c.id}: ${frame.message ?? 'error'}`);
    }
  }

  // One counter per connection across every channel, heartbeats and acknowledgements included, plus one per frame.
  // The documentation scopes it by product and the wire does not, so a gap here is the whole connection's problem.
  private checkSequence(sequence: number, c: SingleSocketConnection): boolean {
    const last = this.lastSequence.get(c);
    this.lastSequence.set(c, sequence);

    if (last === undefined || sequence === last + 1) {
      return true;
    }

    this.resync(c, 'connection', 'sequence_gap', {
      expected: last + 1,
      got: sequence,
    });

    return false;
  }

  private applyEvents(
    events: CoinbaseEvent[],
    c: SingleSocketConnection,
  ): void {
    for (const event of events) {
      const productId = event.product_id;

      if (typeof productId !== 'string' || !this.accepts(c, productId)) {
        continue;
      }

      const updates = event.updates ?? [];

      if (event.type === 'snapshot') {
        const bids: BookLevel[] = [];
        const asks: BookLevel[] = [];

        for (let i = 0; i < updates.length; i++) {
          (updates[i].side === 'bid' ? bids : asks).push(toLevel(updates[i]));
        }

        this.resetBook(productId, bids, asks);
        continue;
      }

      const book = this.bookOf(productId);

      if (book === undefined) {
        this.resync(c, productId, 'update_before_snapshot');
        return;
      }

      for (let i = 0; i < updates.length; i++) {
        const [price, size] = toLevel(updates[i]);

        if (updates[i].side === 'bid') {
          book.setBid(price, size);
        } else {
          book.setAsk(price, size);
        }
      }

      this.publish(productId, book);
    }
  }

  private checkSubscriptions(
    frame: CoinbaseFrame,
    c: SingleSocketConnection,
  ): void {
    const acknowledged = new Set(
      frame.events?.[0]?.subscriptions?.[LEVEL2_CHANNEL] ?? [],
    );
    const missing = [...c.accepted].filter((id) => !acknowledged.has(id));

    if (missing.length === 0) {
      return;
    }

    this.logger.warn(
      `${c.id}: ${missing.length} of ${c.accepted.size} product(s) not acknowledged, starting with ${missing.slice(0, MISSING_SAMPLE).join(', ')}`,
    );
  }
}

function toLevel(update: CoinbaseL2Update): BookLevel {
  return [Number(update.price_level), Number(update.new_quantity)];
}
