import type { BookLevel, Market } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { VenueFeed } from '../../feeds/book/VenueFeed';
import type {
  GeminiBookLevel,
  GeminiDepthUpdate,
  GeminiStreamFrame,
} from './types';

// One address carries every product, and snapshot=-1 makes the first depthUpdate per symbol the whole book.
const PUBLIC_URL = 'wss://ws.gemini.com?snapshot=-1';

// Changed levels every 100 ms, chained by U and u.
const STREAM_SUFFIX = '@depth@100ms';

// The server pings every 20 s, and a quiet book stayed silent for 28 s.
const MAX_SILENCE_MS = 60_000;
const PING_INTERVAL_MS = 20_000;

const DEPTH_EVENT = 'depthUpdate';
const STATUS_OK = 200;

type DepthFrame = Required<
  Pick<GeminiDepthUpdate, 's' | 'U' | 'u' | 'b' | 'a'>
>;

export class GeminiFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  // `u` of the last frame applied, per symbol, kept per connection so a reconnect starts from the snapshot again.
  private readonly lastUpdateId = new WeakMap<
    SingleSocketConnection,
    Map<string, number>
  >();
  private requestId = 0;

  protected planEndpoints(): EndpointPlan[] {
    const markets = this.venue.markets;
    if (markets.length === 0) {
      return [];
    }

    return [{ id: `${this.venue.id}#swap#0`, url: PUBLIC_URL, markets }];
  }

  // One unknown stream name rejects the whole frame, so every name comes from the catalog.
  protected getSubscribeFrames(markets: Market[]): object[] {
    return [
      {
        id: ++this.requestId,
        method: 'subscribe',
        params: markets.map((m) => `${m.rawMarketId}${STREAM_SUFFIX}`),
      },
    ];
  }

  protected startKeepalive(c: SingleSocketConnection): void {
    const ping = setInterval(() => {
      if (c.socket.readyState === c.socket.OPEN) {
        c.socket.send(JSON.stringify({ id: ++this.requestId, method: 'ping' }));
      }
    }, PING_INTERVAL_MS);

    ping.unref();
    c.timers.push(ping);
  }

  protected handleMessage(raw: Buffer, c: SingleSocketConnection): void {
    const frame = JSON.parse(raw.toString('utf8')) as GeminiStreamFrame;

    if (isDepthFrame(frame)) {
      this.applyDepth(frame, c);
      return;
    }

    if (frame.id !== undefined && frame.status !== STATUS_OK) {
      this.logger.error(
        `${c.id}: request ${frame.id} failed with status ${frame.status}: ${frame.error?.code} ${frame.error?.msg}`,
      );
    }
  }

  private applyDepth(frame: DepthFrame, c: SingleSocketConnection): void {
    const symbol = frame.s;

    if (!this.accepts(c, symbol)) {
      return;
    }

    let lastIds = this.lastUpdateId.get(c);
    if (lastIds === undefined) {
      lastIds = new Map();
      this.lastUpdateId.set(c, lastIds);
    }

    const last = lastIds.get(symbol);
    const book = this.bookOf(symbol);

    // The snapshot carries no marker, and the subscribe acknowledgement can arrive before or after it.
    if (last === undefined || book === undefined) {
      lastIds.set(symbol, frame.u);
      this.resetBook(symbol, frame.b.map(toLevel), frame.a.map(toLevel));
      return;
    }

    if (frame.u <= last) {
      return;
    }

    // Ids come from one range across symbols, so only U against this symbol's own last u reveals a gap.
    if (frame.U > last) {
      this.resync(c, symbol, 'sequence_gap', {
        expected: last,
        got: frame.U,
      });
      return;
    }

    lastIds.set(symbol, frame.u);

    for (let i = 0; i < frame.b.length; i++) {
      book.setBid(Number(frame.b[i][0]), Number(frame.b[i][1]));
    }

    for (let i = 0; i < frame.a.length; i++) {
      book.setAsk(Number(frame.a[i][0]), Number(frame.a[i][1]));
    }

    this.publish(symbol, book);
  }
}

function isDepthFrame(frame: GeminiStreamFrame): frame is DepthFrame {
  return (
    frame.e === DEPTH_EVENT &&
    typeof frame.s === 'string' &&
    typeof frame.U === 'number' &&
    typeof frame.u === 'number' &&
    Array.isArray(frame.b) &&
    Array.isArray(frame.a)
  );
}

function toLevel(level: GeminiBookLevel): BookLevel {
  return [Number(level[0]), Number(level[1])];
}
