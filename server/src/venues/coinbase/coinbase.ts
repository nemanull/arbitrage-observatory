import type { Market } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { chunk } from '../../ws/shared';
import { VenueFeed } from '../../ws/VenueFeed';
import type { CoinbaseFrame, CoinbaseTicker } from './types';

// Coinbase Advanced is the only Coinbase platform that serves perpetual market data without credentials.
// The International Exchange socket closes every connection from this host with code 3003 before it reads a subscribe frame.
const PUBLIC_URL = 'wss://advanced-trade-ws.coinbase.com';

const TICKER_CHANNEL = 'ticker';
const HEARTBEATS_CHANNEL = 'heartbeats';
const SUBSCRIPTIONS_CHANNEL = 'subscriptions';

const MARKETS_PER_CONNECTION = 200;
const PRODUCTS_PER_FRAME = 200;

const MAX_SILENCE_MS = 15_000;

const MISSING_SAMPLE = 3;

export class CoinbaseFeed extends VenueFeed {
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

  // The ticker frame goes first on purpose.
  // Every acknowledgement lists the connection's whole subscription set, and checkSubscriptions reads its ticker list.
  // Subscribing heartbeats first would produce one acknowledgement with no ticker key, which reads as every product having been rejected.
  protected getSubscribeFrames(markets: Market[]): object[] {
    const frames: object[] = chunk(markets, PRODUCTS_PER_FRAME).map(
      (slice) => ({
        type: 'subscribe',
        channel: TICKER_CHANNEL,
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

    switch (frame.channel) {
      case TICKER_CHANNEL:
        this.submitTickers(frame, c);
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

  private submitTickers(frame: CoinbaseFrame, c: SingleSocketConnection): void {
    for (const event of frame.events ?? []) {
      for (const ticker of event.tickers ?? []) {
        this.submitTicker(ticker, c);
      }
    }
  }

  private submitTicker(
    ticker: CoinbaseTicker,
    c: SingleSocketConnection,
  ): void {
    if (
      typeof ticker.product_id !== 'string' ||
      !this.accepts(c, ticker.product_id)
    ) {
      return;
    }

    if (!ticker.best_bid || !ticker.best_ask) {
      return;
    }

    this.submit({
      rawMarketId: ticker.product_id,
      bid: Number(ticker.best_bid),
      ask: Number(ticker.best_ask),
      recvTs: Date.now(),
    });
  }

  private checkSubscriptions(
    frame: CoinbaseFrame,
    c: SingleSocketConnection,
  ): void {
    const acknowledged = new Set(
      frame.events?.[0]?.subscriptions?.[TICKER_CHANNEL] ?? [],
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
