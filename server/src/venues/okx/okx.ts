import type { Market } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { chunk } from '../../ws/shared';
import { VenueFeed } from '../../ws/VenueFeed';
import type { OkxBboData, OkxStreamFrame } from './types';

const PUBLIC_URL = 'wss://ws.okx.com:8443/ws/v5/public';
const CHANNEL = 'bbo-tbt';

//450 is the cap
const MARKETS_PER_CONNECTION = 250;

// This is roughtly 10 KB, when the cap is 64 KB
const ARGS_PER_FRAME = 200;

const MAX_SILENCE_MS = 60_000;
const PING_INTERVAL_MS = 20_000;

const PING_FRAME = 'ping';
const PONG_FRAME = 'pong';

export class OkxFeed extends VenueFeed {
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
      this.submitBbo(arg.instId, frame.data, c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private submitBbo(
    instId: string,
    data: OkxBboData[],
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, instId)) {
      return;
    }

    for (const book of data) {
      const bid = book.bids[0];
      const ask = book.asks[0];

      if (!bid || !ask) {
        continue;
      }

      this.submit({
        rawMarketId: instId,
        bid: Number(bid[0]),
        ask: Number(ask[0]),
        bidSize: Number(bid[1]),
        askSize: Number(ask[1]),
        recvTs: Date.now(),
      });
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
