import { OrderBook } from './OrderBook';

describe('OrderBook.reset', () => {
  it('sorts bids descending and asks ascending whatever order they arrive in', () => {
    const book = new OrderBook();

    book.reset(
      [
        [99, 1],
        [101, 2],
        [100, 3],
      ],
      [
        [104, 1],
        [102, 2],
        [103, 3],
      ],
    );

    expect(book.topBids(3)).toEqual([
      [101, 2],
      [100, 3],
      [99, 1],
    ]);
    expect(book.topAsks(3)).toEqual([
      [102, 2],
      [103, 3],
      [104, 1],
    ]);
  });

  it('drops zero sizes and keeps the last size of a repeated price', () => {
    const book = new OrderBook();

    book.reset(
      [
        [100, 1],
        [100, 5],
        [99, 0],
      ],
      [],
    );

    expect(book.topBids(5)).toEqual([[100, 5]]);
    expect(book.askCount).toBe(0);
  });

  it('replaces the previous book entirely', () => {
    const book = new OrderBook();
    book.reset([[100, 1]], [[101, 1]]);

    book.reset([[90, 2]], [[91, 2]]);

    expect(book.topBids(5)).toEqual([[90, 2]]);
    expect(book.topAsks(5)).toEqual([[91, 2]]);
  });
});

describe('OrderBook.setBid and setAsk', () => {
  it('inserts a new level in price order', () => {
    const book = new OrderBook();
    book.reset(
      [
        [100, 1],
        [98, 1],
      ],
      [
        [101, 1],
        [103, 1],
      ],
    );

    book.setBid(99, 4);
    book.setAsk(102, 4);

    expect(book.topBids(3)).toEqual([
      [100, 1],
      [99, 4],
      [98, 1],
    ]);
    expect(book.topAsks(3)).toEqual([
      [101, 1],
      [102, 4],
      [103, 1],
    ]);
  });

  it('updates the size of an existing level in place', () => {
    const book = new OrderBook();
    book.reset([[100, 1]], [[101, 1]]);

    book.setBid(100, 7);
    book.setAsk(101, 8);

    expect(book.topBids(1)).toEqual([[100, 7]]);
    expect(book.topAsks(1)).toEqual([[101, 8]]);
    expect(book.bidCount).toBe(1);
  });

  it('removes a level on a zero size and shifts the rest up', () => {
    const book = new OrderBook();
    book.reset(
      [
        [100, 1],
        [99, 2],
      ],
      [[101, 1]],
    );

    book.setBid(100, 0);

    expect(book.topBids(2)).toEqual([[99, 2]]);
    expect(book.bidCount).toBe(1);
  });

  it('ignores a zero size for a price it does not hold', () => {
    const book = new OrderBook();
    book.reset([[100, 1]], []);

    expect(book.setBid(50, 0)).toBe(true);
    expect(book.topBids(2)).toEqual([[100, 1]]);
  });

  it('refuses a non-finite or non-positive price and a negative size, and changes nothing', () => {
    const book = new OrderBook();
    book.reset([[100, 1]], []);

    expect(book.setBid(Number.NaN, 1)).toBe(false);
    expect(book.setBid(0, 1)).toBe(false);
    expect(book.setBid(100, -1)).toBe(false);
    expect(book.setAsk(Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(book.topBids(2)).toEqual([[100, 1]]);
    expect(book.askCount).toBe(0);
  });

  it('inserts at both ends of a side', () => {
    const book = new OrderBook();
    book.reset([[100, 1]], [[101, 1]]);

    book.setBid(105, 1);
    book.setBid(1, 1);
    book.setAsk(200, 1);
    book.setAsk(100.5, 1);

    expect(book.topBids(3)).toEqual([
      [105, 1],
      [100, 1],
      [1, 1],
    ]);
    expect(book.topAsks(3)).toEqual([
      [100.5, 1],
      [101, 1],
      [200, 1],
    ]);
  });
});

describe('OrderBook.topBids and topAsks', () => {
  it('returns at most the requested number of levels and copies rather than aliases', () => {
    const book = new OrderBook();
    book.reset(
      [
        [100, 1],
        [99, 1],
        [98, 1],
      ],
      [],
    );

    const top = book.topBids(2);
    top[0][1] = 999;

    expect(top).toHaveLength(2);
    expect(book.topBids(1)).toEqual([[100, 1]]);
  });

  it('returns an empty array for an empty side', () => {
    const book = new OrderBook();

    expect(book.topBids(20)).toEqual([]);
    expect(book.topAsks(20)).toEqual([]);
  });
});
