import type { BookLevel, Market } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { chunk } from '../../feeds/book/shared';
import { VenueFeed } from '../../feeds/book/VenueFeed';
import type { GateBookLevel, GateObuResult, GateStreamFrame } from './types';

// One socket carries one settlement family, and a contract of another family is acknowledged and then never delivers.
const USDT_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';

// Fifty levels at a 20 ms push, snapshot then deltas chained by update id.
const CHANNEL = 'futures.obu';
const DEPTH = 50;

// 150 streams ran on one socket with no gap at 443 frames a second on 2026-09-15, and no cap is published, so a larger slice is untested.
const MARKETS_PER_CONNECTION = 150;

// The server sends no ping and closes a socket that has been silent for 30 s, and a quiet contract went 36 s without a book frame.
// So the pong is the traffic the silence watch relies on, and three missed pongs is a dead socket.
const PING_INTERVAL_MS = 15_000;
const MAX_SILENCE_MS = 45_000;

export class GateFeed extends VenueFeed {
  protected readonly maxSilenceMs = MAX_SILENCE_MS;
  private readonly lastUpdateId = new Map<string, number>(); // `u` of the last frame applied, per contract

  protected planEndpoints(): EndpointPlan[] {
    return chunk(this.venue.markets, MARKETS_PER_CONNECTION).map(
      (slice, i) => ({
        id: `${this.venue.id}#usdt#${i}`,
        url: USDT_URL,
        markets: slice,
      }),
    );
  }

  // A multi stream payload is acknowledged as one, so a whole slice goes in one frame.
  protected getSubscribeFrames(markets: Market[]): object[] {
    return [
      {
        time: nowSeconds(),
        channel: CHANNEL,
        event: 'subscribe',
        payload: markets.map(streamName),
      },
    ];
  }

  protected startKeepalive(c: SingleSocketConnection): void {
    const ping = setInterval(() => {
      if (c.socket.readyState === c.socket.OPEN) {
        c.socket.send(
          JSON.stringify({ time: nowSeconds(), channel: 'futures.ping' }),
        );
      }
    }, PING_INTERVAL_MS);

    ping.unref();
    c.timers.push(ping);
  }

  protected handleMessage(raw: Buffer, c: SingleSocketConnection): void {
    const frame = JSON.parse(raw.toString('utf8')) as GateStreamFrame;
    const result = frame.result;

    if (
      frame.channel === CHANNEL &&
      frame.event === 'update' &&
      typeof result?.s === 'string'
    ) {
      this.applyBook(contractOf(result.s), result, c);
      return;
    }

    this.handleControlFrame(frame, c);
  }

  private applyBook(
    contract: string,
    result: Partial<GateObuResult>,
    c: SingleSocketConnection,
  ): void {
    if (!this.accepts(c, contract)) {
      return;
    }

    const bids = (result.b ?? []).map(toLevel);
    const asks = (result.a ?? []).map(toLevel);

    // A full push replaces the book whenever it comes, not only after the subscribe.
    if (result.full === true) {
      this.lastUpdateId.set(contract, result.u ?? 0);
      this.resetBook(contract, bids, asks);
      return;
    }

    const book = this.bookOf(contract);
    const last = this.lastUpdateId.get(contract);

    if (book === undefined || last === undefined) {
      this.resync(c, contract, 'delta_before_snapshot');
      return;
    }

    if (result.U !== last + 1) {
      this.resync(c, contract, 'sequence_gap', {
        expected: last + 1,
        got: result.U,
      });
      return;
    }

    this.lastUpdateId.set(contract, result.u ?? 0);

    // A delta with no levels changed a level outside the fifty, so it only moves the id.
    if (bids.length === 0 && asks.length === 0) {
      return;
    }

    for (let i = 0; i < bids.length; i++) {
      book.setBid(bids[i][0], bids[i][1]);
    }

    for (let i = 0; i < asks.length; i++) {
      book.setAsk(asks[i][0], asks[i][1]);
    }

    this.publish(contract, book);
  }

  private handleControlFrame(
    frame: GateStreamFrame,
    c: SingleSocketConnection,
  ): void {
    if (frame.error) {
      this.logger.error(
        `${c.id}: ${frame.channel ?? 'request'} ${frame.event ?? ''} error ${frame.error.code}: ${frame.error.message ?? ''}`,
      );
    } else if (frame.channel === 'futures.system') {
      // An upgrade notice comes before a shutdown, and the close path still does the reconnect.
      this.logger.warn(`${c.id}: system ${frame.result?.type ?? ''}`);
    }
  }
}

function toLevel(level: GateBookLevel): BookLevel {
  return [Number(level[0]), Number(level[1])];
}

function streamName(market: Market): string {
  return `ob.${market.rawMarketId}.${DEPTH}`;
}

// 'ob.BTC_USDT.50' names the contract 'BTC_USDT'.
function contractOf(stream: string): string {
  return stream.slice(3, stream.lastIndexOf('.'));
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
