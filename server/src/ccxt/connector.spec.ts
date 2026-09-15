import { Logger } from '@nestjs/common';
import type { Exchange, MarketInterface } from 'ccxt';
import { VenueConnector } from './connector';

const VENUE_ID = 'okx';
const TAKER_PPM = 500;

// loadMarkets is the only call the connector makes, so an id, a name and that one method stand in for the ccxt exchange.
function exchange(markets: MarketInterface[]): Exchange {
  return {
    id: VENUE_ID,
    name: 'OKX',
    loadMarkets: () =>
      Promise.resolve(Object.fromEntries(markets.map((m) => [m.symbol, m]))),
  } as unknown as Exchange;
}

function swap(id: string, contractSize?: number | null): MarketInterface {
  const [base, quote] = id.split('-');

  return {
    id,
    symbol: `${base}/${quote}:${quote}`,
    base,
    quote,
    type: 'swap',
    swap: true,
    active: true,
    linear: true,
    taker: TAKER_PPM / 1e6,
    contractSize,
  } as unknown as MarketInterface;
}

afterEach(() => jest.restoreAllMocks());

describe('VenueConnector.loadVenue contractSize', () => {
  it('keeps a positive finite contract size and reads every other value as 1', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const connector = new VenueConnector(
      exchange([
        swap('BTC-USDT-SWAP', 0.01),
        swap('ETH-USDT-SWAP', undefined),
        swap('SOL-USDT-SWAP', null),
        swap('XRP-USDT-SWAP', 0),
        swap('DOGE-USDT-SWAP', -1),
        swap('ADA-USDT-SWAP', Number.NaN),
        swap('LTC-USDT-SWAP', Number.POSITIVE_INFINITY),
      ]),
      { takerPpm: TAKER_PPM },
    );

    const venue = await connector.loadVenue();

    expect(venue?.markets.map((m) => [m.rawMarketId, m.contractSize])).toEqual([
      ['BTC-USDT-SWAP', 0.01],
      ['ETH-USDT-SWAP', 1],
      ['SOL-USDT-SWAP', 1],
      ['XRP-USDT-SWAP', 1],
      ['DOGE-USDT-SWAP', 1],
      ['ADA-USDT-SWAP', 1],
      ['LTC-USDT-SWAP', 1],
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        '1 of 7 markets have a contract size other than 1',
      ),
    );
  });

  it('says nothing about contract size when every market is one coin per contract', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const connector = new VenueConnector(
      exchange([swap('BTC-USDT-SWAP', 1), swap('ETH-USDT-SWAP', undefined)]),
      { takerPpm: TAKER_PPM },
    );

    const venue = await connector.loadVenue();

    expect(venue?.markets.map((m) => m.contractSize)).toEqual([1, 1]);
    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining('contract size'),
    );
  });
});

describe('VenueConnector registry pins', () => {
  it('pins every market to the registry contract size over what CCXT reports', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const connector = new VenueConnector(
      exchange([swap('BTC-USDC-SWAP', 0.5), swap('ETH-USDC-SWAP', undefined)]),
      { takerPpm: TAKER_PPM, contractSize: 1 },
    );

    const venue = await connector.loadVenue();

    expect(venue?.markets.map((m) => m.contractSize)).toEqual([1, 1]);
  });

  it('compares no CCXT fee when the registry ignores it', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const webRate = { ...swap('ETH-USDT-SWAP', 1), taker: 0.0002 };
    const zeroRate = { ...swap('SOL-USDT-SWAP', 1), taker: 0 };
    const connector = new VenueConnector(
      exchange([webRate, zeroRate] as MarketInterface[]),
      { takerPpm: 800, ignoreCcxtTakerPpm: true },
    );

    const venue = await connector.loadVenue();

    expect(venue?.markets.map((m) => m.takerPpm)).toEqual([800, 800]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('still warns on a CCXT fee the registry does not expect', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const webRate = { ...swap('ETH-USDT-SWAP', 1), taker: 0.0002 };
    const connector = new VenueConnector(
      exchange([webRate] as MarketInterface[]),
      { takerPpm: 800 },
    );

    await connector.loadVenue();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('CCXT reports 200 ppm on 1 of 1 markets'),
    );
  });
});
