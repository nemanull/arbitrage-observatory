import type { Market } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { chunk } from '../../ws/shared';
import { VenueFeed } from '../../ws/VenueFeed';
import type { BybitOrderbookLevel, BybitStreamFrame } from './types';

// Bybit splits its public endpoints by market family, and one connection cannot carry topics from two families.
const LINEAR_URL = 'wss://stream.bybit.com/v5/public/linear';
const INVERSE_URL = 'wss://stream.bybit.com/v5/public/inverse';

// Bybit caps the cumulative public argument string at 21,000 characters per connection, and a 200 topic slice measures 4,688.
// It also allows 1,000 concurrent connections per family, so more and smaller sockets cost nothing.
const MARKETS_PER_CONNECTION = 200;

// A full slice fits in one frame.
// The chunk is what keeps the frame inside the character cap if the slice size ever grows.
const TOPICS_PER_FRAME = 200;

// The application ping below is answered every 20 seconds, so three missed answers is a dead socket.
// Bybit also repeats an unchanged depth one snapshot after three idle seconds, so a live socket is never quiet this long.
const MAX_SILENCE_MS = 60_000;
const PING_INTERVAL_MS = 20_000;

export class BybitFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;

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

    if (data && typeof data.s === 'string') {
      this.submitSnapshot(data.s, data.b?.[0], data.a?.[0], c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private submitSnapshot(
    symbol: string,
    bid: BybitOrderbookLevel | undefined,
    ask: BybitOrderbookLevel | undefined,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, symbol)) {
      return;
    }

    if (bid === undefined || ask === undefined) {
      return;
    }

    this.submit({
      rawMarketId: symbol,
      bid: Number(bid[0]),
      ask: Number(ask[0]),
      bidSize: Number(bid[1]),
      askSize: Number(ask[1]),
      recvTs: Date.now(),
    });
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

function topicName(market: Market): string {
  return `orderbook.1.${market.rawMarketId}`;
}
