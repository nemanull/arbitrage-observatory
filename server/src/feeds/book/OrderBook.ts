import type { BookLevel } from '../../engine/types';

export class OrderBook {
  private bidPrices: number[] = [];
  private bidSizes: number[] = [];
  private askPrices: number[] = [];
  private askSizes: number[] = [];

  get bidCount(): number {
    return this.bidPrices.length;
  }

  get askCount(): number {
    return this.askPrices.length;
  }

  reset(bids: readonly BookLevel[], asks: readonly BookLevel[]): void {
    this.bidPrices = [];
    this.bidSizes = [];
    this.askPrices = [];
    this.askSizes = [];

    for (const [price, size] of bids) {
      this.setBid(price, size);
    }

    for (const [price, size] of asks) {
      this.setAsk(price, size);
    }
  }

  setBid(price: number, size: number): boolean {
    return setLevel(this.bidPrices, this.bidSizes, price, size, true);
  }

  setAsk(price: number, size: number): boolean {
    return setLevel(this.askPrices, this.askSizes, price, size, false);
  }

  topBids(levels: number): BookLevel[] {
    return top(this.bidPrices, this.bidSizes, levels);
  }

  topAsks(levels: number): BookLevel[] {
    return top(this.askPrices, this.askSizes, levels);
  }
}

function lowerBound(
  prices: number[],
  price: number,
  descending: boolean,
): number {
  let lo = 0;
  let hi = prices.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const before = descending ? prices[mid] > price : prices[mid] < price;

    if (before) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}

function setLevel(
  prices: number[],
  sizes: number[],
  price: number,
  size: number,
  descending: boolean,
): boolean {
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(size) ||
    size < 0
  ) {
    return false;
  }

  const i = lowerBound(prices, price, descending);
  const found = i < prices.length && prices[i] === price;

  if (size === 0) {
    if (found) {
      prices.splice(i, 1);
      sizes.splice(i, 1);
    }
    return true;
  }

  if (found) {
    sizes[i] = size;
  } else {
    prices.splice(i, 0, price);
    sizes.splice(i, 0, size);
  }

  return true;
}

function top(prices: number[], sizes: number[], levels: number): BookLevel[] {
  const count = Math.min(levels, prices.length);
  const out: BookLevel[] = new Array<BookLevel>(count);

  for (let l = 0; l < count; l++) {
    out[l] = [prices[l], sizes[l]];
  }

  return out;
}
