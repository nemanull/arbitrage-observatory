import { Logger } from '@nestjs/common';
import type { Cluster, Opportunity } from './types';

const MIN_NET_PPM = 5_000; // 0.5% after fees



export class OpportunityManager {
  private logger = new Logger(OpportunityManager.name);

  constructor() {}


  validate(cluster: Cluster): Opportunity | null {
    const highestBidResult = this.getEffectiveHighestBid(cluster.bid, cluster.bidMul);
    const lowestAskResult = this.getEffectiveLowestAsk(cluster.ask, cluster.askMul);

    if (highestBidResult === null || lowestAskResult === null) {
      return null;
    }

    const { index: highestBidIndex, value: highestBid } = highestBidResult;
    const { index: lowestAskIndex, value: lowestAsk } = lowestAskResult;

    if (highestBidIndex === lowestAskIndex) {
      return null;
    }

    const highestBidMarket = cluster.markets[highestBidIndex];
    const lowestAskMarket = cluster.markets[lowestAskIndex];

    if (highestBidMarket === null || lowestAskMarket === null) {
      return null;
    }

    const netPpm = (highestBid / lowestAsk - 1) * 1_000_000;

    if (netPpm < MIN_NET_PPM) {
      return null;
    }

    this.logger.log(`Opportunity found between venues ${highestBidMarket.venueId} and ${lowestAskMarket.venueId} for ${lowestAskMarket.base} / ${lowestAskMarket.quote}: ${netPpm}ppm`);

    return {
      netPpm,
      highestBid,
      lowestAsk,
      highestBidMarket,
      lowestAskMarket,
    };
  }


  private getEffectiveHighestBid(bids: Float64Array, bidMul: Float64Array): { index: number, value: number } | null {
    let highest = 0;
    let index = -1;

    for (let i = 0; i < bids.length; i++) {
      const bidAfterFees = bids[i] * bidMul[i];

      if (bidAfterFees > highest) {
        highest = bidAfterFees;
        index = i;
      }
    }

    if (highest === 0) {
      return null;
    }

    return { index, value: highest };
  }

  private getEffectiveLowestAsk(asks: Float64Array, askMul: Float64Array): { index: number, value: number } | null {
    let lowest = Infinity;
    let index = -1;

    for (let i = 0; i < asks.length; i++) {
      const ask = asks[i];
      const askAfterFees = ask * askMul[i];

      if (ask > 0 && askAfterFees < lowest) {
        lowest = askAfterFees;
        index = i;
      }
    }

    if (lowest === Infinity) {
      return null;
    }

    return { index, value: lowest };
  }
  
}




