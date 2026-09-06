import type { Market } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { chunk } from '../../ws/shared';
import { VenueFeed } from '../../ws/VenueFeed';
import type { KrakenFuturesFrame } from './types';

const PUBLIC_URL = 'wss://futures.kraken.com/ws/v1';
const CHANNEL = 'ticker';


const MARKETS_PER_CONNECTION = 100;
const PRODUCTS_PER_FRAME = 100;

const MAX_SILENCE_MS = 30_000;

// Kraken documents a 60 second ping requirement and does not enforce it, so this keeps a threefold margin.
const PING_INTERVAL_MS = 20_000;

export class KrakenFuturesFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;

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
      feed: CHANNEL,
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

    if (frame.feed === CHANNEL && typeof frame.product_id === 'string') {
      this.submitTicker(frame.product_id, frame.bid, frame.ask, c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private submitTicker(
    productId: string,
    bid: number | undefined,
    ask: number | undefined,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, productId)) {
      return;
    }

    if (bid === undefined || ask === undefined || !(bid > 0) || !(ask > 0)) {
      return;
    }

    this.submit({
      rawMarketId: productId,
      bid,
      ask,
      recvTs: Date.now(),
    });
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
