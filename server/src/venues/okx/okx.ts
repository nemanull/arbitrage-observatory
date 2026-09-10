import type { BookLevel, Market } from '../../engine/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { chunk } from '../../feeds/book/shared';
import { VenueFeed } from '../../feeds/book/VenueFeed';
import type { OkxBookLevel, OkxBooksData, OkxStreamFrame } from './types';

const PUBLIC_URL = 'wss://ws.okx.com:8443/ws/v5/public';

// 400 levels at a 100 ms push, snapshot then updates. The tick by tick book channels need a VIP login.
const CHANNEL = 'books';

// Two connections carried 473 instruments of `books` with full coverage on 2026-09-07.
const MARKETS_PER_CONNECTION = 250;

// This is roughly 10 KB, when the cap is 64 KB
const ARGS_PER_FRAME = 200;

// Okx allows three handshakes a second per IP.
const CONNECT_STAGGER_MS = 400;

const MAX_SILENCE_MS = 60_000;
const PING_INTERVAL_MS = 20_000;

const PING_FRAME = 'ping';
const PONG_FRAME = 'pong';

export class OkxFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  protected readonly connectStaggerMs = CONNECT_STAGGER_MS;
  private readonly lastSeqId = new Map<string, number>(); // `seqId` of the last frame applied, per instrument

  protected planEndpoints(): EndpointPlan[] {
    return chunk(this.venue.markets, MARKETS_PER_CONNECTION).map(
      (slice, i) => ({
        id: `${this.venue.id}#swap#${i}`,
        url: PUBLIC_URL,
        markets: slice,
      }),
    );
  }

  protected getSubscribeFrames(markets: Market[]): object[] {
    return chunk(markets, ARGS_PER_FRAME).map((slice, i) => ({
      id: `sub${i}`,
      op: 'subscribe',
      args: slice.map((m) => ({ channel: CHANNEL, instId: m.rawMarketId })),
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

    const frame = JSON.parse(text) as OkxStreamFrame;
    const arg = frame.arg;
    if (arg?.channel === CHANNEL && Array.isArray(frame.data)) {
      this.applyBooks(arg.instId, frame.action, frame.data, c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private applyBooks(
    instId: string,
    action: string | undefined,
    data: OkxBooksData[],
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, instId)) {
      return;
    }

    for (const entry of data) {
      const bids = entry.bids.map(toLevel);
      const asks = entry.asks.map(toLevel);

      if (action === 'snapshot') {
        this.lastSeqId.set(instId, entry.seqId);
        this.resetBook(instId, bids, asks);
        continue;
      }

      const book = this.bookOf(instId);
      const last = this.lastSeqId.get(instId);

      if (book === undefined || last === undefined) {
        this.resync(c, instId, 'update_before_snapshot');
        return;
      }

      if (entry.prevSeqId !== last) {
        this.resync(c, instId, 'sequence_gap', {
          expected: last,
          got: entry.prevSeqId,
          seqId: entry.seqId,
        });
        return;
      }

      if (entry.seqId === entry.prevSeqId) {
        continue;
      }

      this.lastSeqId.set(instId, entry.seqId);

      for (let i = 0; i < bids.length; i++) {
        book.setBid(bids[i][0], bids[i][1]);
      }

      for (let i = 0; i < asks.length; i++) {
        book.setAsk(asks[i][0], asks[i][1]);
      }

      this.publish(instId, book);
    }
  }

  private handleControlFrame(
    frame: OkxStreamFrame,
    c: SingleSocketConnection,
  ): void {
    if (frame.event === 'error') {
      this.logger.error(`${c.id}: error ${frame.code}: ${frame.msg}`);
    } else if (frame.event === 'notice') {
      // Code 64008 announces a service upgrade about 60 seconds ahead, and it is the only in-band close warning any venue sends.
      // The ordinary close path still does the reconnect, so this line only explains one that would otherwise look unprompted.
      this.logger.warn(`${c.id}: notice ${frame.code}: ${frame.msg}`);
    }
  }
}

function toLevel(level: OkxBookLevel): BookLevel {
  return [Number(level[0]), Number(level[1])];
}
