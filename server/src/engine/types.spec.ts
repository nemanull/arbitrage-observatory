import type { PairKey } from './types';

describe('PairKey', () => {
  it('represents a normalized pair key', () => {
    const pair: PairKey = 'BTC|USDT';

    expect(pair).toBe('BTC|USDT');
  });
});
