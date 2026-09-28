import type { BookLevel, Market } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { chunk } from '../../feeds/book/shared';
import { VenueFeed } from '../../feeds/book/VenueFeed';
import type {
  BitstampBookData,
  BitstampBookLevel,
  BitstampStreamFrame,
} from './types';

// One address carries every spot and perpetual market.
const PUBLIC_URL = 'wss://ws.bitstamp.net';

// A whole book of up to 100 levels a side on every change, with no sequence and no snapshot on subscribe.
const CHANNEL_PREFIX = 'order_book_';

// A 1,025th subscription closes the connection with no error, and the venue lists 20 perpetuals today.
const MARKETS_PER_CONNECTION = 1_000;

// A quiet book stayed silent for 49 s, so the heartbeat answer is what keeps the silence watch fed.
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_SILENCE_MS = 60_000;

// The first book is the next change, which took up to 49 s on a quiet market.
const FIRST_BOOK_WAIT_MS = 60_000;

type BookFrame = Required<
  Pick<BitstampBookData, 'microtimestamp' | 'bids' | 'asks'>
>;

export class BitstampFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  protected readonly firstBookWaitMs = FIRST_BOOK_WAIT_MS;
  private readonly lastMicrotimestamp = new Map<string, number>(); // of the last frame applied, per market

  protected planEndpoints(): EndpointPlan[] {
    return chunk(this.venue.markets, MARKETS_PER_CONNECTION).map(
      (slice, i) => ({
        id: `${this.venue.id}#swap#${i}`,
        url: PUBLIC_URL,
        markets: slice,
      }),
    );
  }

  // One channel per frame, and a client frame over 512 bytes closes the socket with code 1009.
  protected getSubscribeFrames(markets: Market[]): object[] {
    return markets.map((m) => ({
      event: 'bts:subscribe',
      data: { channel: `${CHANNEL_PREFIX}${m.rawMarketId}` },
    }));
  }

  protected startKeepalive(c: SingleSocketConnection): void {
    const heartbeat = setInterval(() => {
      if (c.socket.readyState === c.socket.OPEN) {
        c.socket.send(JSON.stringify({ event: 'bts:heartbeat' }));
      }
    }, HEARTBEAT_INTERVAL_MS);

    heartbeat.unref();
    c.timers.push(heartbeat);
  }

  protected handleMessage(raw: Buffer, c: SingleSocketConnection): void {
    const frame = JSON.parse(raw.toString('utf8')) as BitstampStreamFrame;
    const channel = frame.channel;

    if (
      frame.event === 'data' &&
      channel?.startsWith(CHANNEL_PREFIX) &&
      isBookData(frame.data)
    ) {
      this.applyBook(channel.slice(CHANNEL_PREFIX.length), frame.data, c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private applyBook(
    rawMarketId: string,
    data: BookFrame,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, rawMarketId)) {
      return;
    }

    // Never seen on the wire, and an older whole book would rewind the one applied.
    const microtimestamp = Number(data.microtimestamp);
    if (!(microtimestamp > (this.lastMicrotimestamp.get(rawMarketId) ?? 0))) {
      return;
    }

    this.lastMicrotimestamp.set(rawMarketId, microtimestamp);
    this.resetBook(rawMarketId, data.bids.map(toLevel), data.asks.map(toLevel));
  }

  private handleControlFrame(
    frame: BitstampStreamFrame,
    c: SingleSocketConnection,
  ): void {
    if (frame.event === 'bts:request_reconnect') {
      // The venue gives a few seconds before it drops the connection.
      this.logger.warn(`${c.id}: venue requested a reconnect`);
      this.closeConnection(c, true);
    } else if (frame.event === 'bts:error') {
      this.logger.error(
        `${c.id}: bts:error (code ${frame.data?.code ?? 'none'}): ${frame.data?.message ?? ''}`,
      );
    }
  }
}

function isBookData(data: BitstampStreamFrame['data']): data is BookFrame {
  return (
    typeof data?.microtimestamp === 'string' &&
    Array.isArray(data.bids) &&
    Array.isArray(data.asks)
  );
}

function toLevel(level: BitstampBookLevel): BookLevel {
  return [Number(level[0]), Number(level[1])];
}
