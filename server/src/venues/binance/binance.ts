import type { Market } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { chunk } from '../../ws/shared';
import { VenueFeed } from '../../ws/VenueFeed';
import type { BinanceStreamFrame } from './types';

// Binance routes book data to its own host and path.
// Trades, mark price, and funding live on /market/ws, which a top-of-book feed never needs.
const USD_M_BOOK_URL = 'wss://fstream.binance.com/public/ws';
const COIN_M_BOOK_URL = 'wss://dstream.binance.com/ws';

// USD-M allows 1024 streams per connection and COIN-M publishes no limit at all. We play it safe for now
const MARKETS_PER_CONNECTION = 200;
const STREAMS_PER_FRAME = 100;
const MAX_SILENCE_MS = 240_000;

// Binance answers our ping, but the point of sending one is the write itself.
const CLIENT_PING_INTERVAL_MS = 30_000;

// Binance closes every socket at the 24 hour mark with no in-band warning.
const CONNECTION_REFRESH_MS = 23 * 60 * 60 * 1000;
const CONNECTION_REFRESH_JITTER_MS = 30 * 60 * 1000;

export class BinanceFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;

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
      url: `${baseUrl}/${streamName(slice[0])}`,
      markets: slice,
    }));
  }

  protected getSubscribeFrames(markets: Market[]): object[] {
    return chunk(markets, STREAMS_PER_FRAME).map((slice, i) => ({
      method: 'SUBSCRIBE',
      params: slice.map(streamName),
      id: i + 1,
    }));
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

    if (
      typeof event.s === 'string' &&
      typeof event.b === 'string' &&
      typeof event.a === 'string'
    ) {
      this.submitBookTicker(event.s, event.b, event.a, c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private submitBookTicker(
    symbol: string,
    bid: string,
    ask: string,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, symbol)) {
      return;
    }

    this.submit({
      rawMarketId: symbol,
      bid: Number(bid),
      ask: Number(ask),
      recvTs: Date.now(),
    });
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

function streamName(market: Market): string {
  return `${market.rawMarketId.toLowerCase()}@bookTicker`;
}
