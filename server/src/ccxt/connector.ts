import ccxt from 'ccxt';
import { Exchange, Market as CCXTMarket } from 'ccxt';
import { ExchangeSwapMarkets, SwapMarket } from './types';
import { Logger } from '@nestjs/common';

export class ExchangeConnector {
  public logger: Logger;

  constructor() {
    this.logger = new Logger();
  }

  exchanges = [
    new ccxt.pro.binance(),
    new ccxt.pro.bybit(),
    new ccxt.pro.okx(),
    new ccxt.pro.coinbaseinternational(),
    new ccxt.pro.krakenfutures(),
  ]; // This should be a fucntion that later gets all active exchnages from the db

  async getExchangeSwapMarkets(
    exchange: Exchange,
  ): Promise<ExchangeSwapMarkets | null> {
    try {
      const markets = await exchange.loadMarkets();
      let exchnage_name = exchange.name;

      if (!markets) {
        this.logger.error(`Markets for ${exchange.name} are undefined`);
      }
      if (!exchnage_name) {
        exchnage_name = exchange.id;
        this.logger.warn(`Exchnage ${exchange.id} doesn't have a name`);
      }

      const perpetuals = Object.values(markets).filter(isActiveSwapMarket);

      return {
        exchangeId: exchange.id,
        exchangeName: exchnage_name,
        markets: perpetuals,
      };
    } catch {
      this.logger.error(
        `There was an error with market loading for ${exchange.name}`,
      );
    }
    return null;
  }
}

function isActiveSwapMarket(market: CCXTMarket): market is SwapMarket {
  return (
    market !== undefined &&
    market.type === 'swap' &&
    market.swap === true &&
    market.active !== false
  );
}





