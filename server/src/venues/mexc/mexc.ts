import type { BookLevel, Market } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { chunk } from '../../feeds/book/shared';
import { VenueFeed } from '../../feeds/book/VenueFeed';
import type { MexcBookLevel, MexcDepthData, MexcStreamFrame } from './types';

// One socket carries the USDT, USDC and coin margined contracts alike.
const PUBLIC_URL = 'wss://contract.mexc.com/edge';

// A whole top of book on every push, about every 300 ms, so a frame needs no seed and no gap rule.
// The merged incremental channel is about 100 ms sooner and needs a REST seed per contract.
const SUBSCRIBE_METHOD = 'sub.depth.full';
const PUSH_CHANNEL = 'push.depth.full';
const ERROR_CHANNEL = 'rs.error';

// Its level count must stay at or above Engine.depthLevels.
const DEPTH = 20;

// 150 contracts ran on one socket with no refusal on 2026-09-15, and MEXC publishes no cap.
const MARKETS_PER_CONNECTION = 150;

// The protocol takes one contract per frame and publishes no message rate, so the frames go out at the 20 a second the probe sent.
const SUBSCRIBE_GAP_MS = 50;

// The server closed a socket that sent no ping after about 60 s even while depth flowed, so traffic does not replace the ping.
const PING_INTERVAL_MS = 15_000;
const MAX_SILENCE_MS = 45_000;

const PING_FRAME = JSON.stringify({ method: 'ping' });
const OPEN_BRACE = 0x7b;

export class MexcFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  protected readonly subscribeGapMs = SUBSCRIBE_GAP_MS;
  private readonly lastVersion = new Map<string, number>(); // `version` of the last frame applied, per contract
  private warnedBinary = false;

  protected planEndpoints(): EndpointPlan[] {
    return chunk(this.venue.markets, MARKETS_PER_CONNECTION).map(
      (slice, i) => ({
        id: `${this.venue.id}#swap#${i}`,
        url: PUBLIC_URL,
        markets: slice,
      }),
    );
  }

  // No gzip key is sent, and every frame arrived as text without one.
  protected getSubscribeFrames(markets: Market[]): object[] {
    return markets.map((m) => ({
      method: SUBSCRIBE_METHOD,
      param: { symbol: m.rawMarketId, limit: DEPTH },
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
    // The docs imply a gzip frame is possible, and it would fail to parse on every push.
    // The base class does not pass the frame type, so anything that does not open as a JSON object is taken as binary.
    if (raw[0] !== OPEN_BRACE) {
      this.warnBinary(raw, c);
      return;
    }

    const frame = JSON.parse(raw.toString('utf8')) as MexcStreamFrame;

    if (
      frame.channel === PUSH_CHANNEL &&
      typeof frame.symbol === 'string' &&
      typeof frame.data === 'object' &&
      frame.data !== null
    ) {
      this.applyBook(frame.symbol, frame.data, c);
      return;
    }

    // The error names the contract only in its text, and the success acknowledgement names nothing.
    if (frame.channel === ERROR_CHANNEL) {
      const text =
        typeof frame.data === 'string'
          ? frame.data
          : JSON.stringify(frame.data);
      this.logger.error(`${c.id}: ${text}`);
    }
  }

  private applyBook(
    symbol: string,
    data: MexcDepthData,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, symbol)) {
      return;
    }

    // A connection that has not applied a frame for this contract yet takes any version, so a venue counter reset heals on reconnect.
    const last = this.lastVersion.get(symbol);
    if (
      last !== undefined &&
      this.bookOf(symbol) !== undefined &&
      data.version < last
    ) {
      return;
    }

    this.lastVersion.set(symbol, data.version);
    this.resetBook(
      symbol,
      (data.bids ?? []).map(toLevel),
      (data.asks ?? []).map(toLevel),
    );
  }

  private warnBinary(raw: Buffer, c: SingleSocketConnection): void {
    if (this.warnedBinary) {
      return;
    }

    this.warnedBinary = true;
    this.logger.warn(
      `${c.id}: dropped a binary frame of ${raw.length} bytes, and later ones are dropped silently`,
    );
  }
}

function toLevel(level: MexcBookLevel): BookLevel {
  return [level[0], level[1]];
}
