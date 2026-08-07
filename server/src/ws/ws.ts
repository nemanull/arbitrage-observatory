import type { ClusterIndex, Market } from '../engine/types';
import type {
  EndpointPlan,
  NormalizedQuote,
  VenueConnection,
  VenueSpec,
} from './types';
import { Logger } from '@nestjs/common';

export abstract class VenueFeed {
  public abstract readonly venueId: string;
  public abstract readonly spec: VenueSpec;
  public logger: Logger = new Logger();

  constructor(protected readonly index: ClusterIndex) {}

  public abstract getAllEndpoints(markets: Market[]): EndpointPlan[];
  public abstract getSubscribeFrames(markets: Market[]): object[];

  protected abstract handleMessages(
    raw: Buffer,
    connection: VenueConnection,
  ): void;

  protected submit(connection: VenueConnection, quote: NormalizedQuote): void {
    const slot = this.index.idBySymbol
      .get(this.venueId)
      ?.get(quote.rawMarketId);

    if (slot === undefined) {
      this.logger.warn(`Slot for venue ${this.venueId} is undefined`);
      return;
    }

    const { cluster, i } = slot;

    cluster.bid[i] = quote.bid;
    cluster.ask[i] = quote.ask;
    cluster.recvTs[i] = quote.receivedAtMs;
  }
}

export class WSVenueLogic {
  constructor(public readonly feeds: readonly VenueFeed[]) {}

  // placeholder for now
}
