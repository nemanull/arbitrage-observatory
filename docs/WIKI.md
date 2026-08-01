  //
  // A Cluster is a set of markets that trade the same asset on different
  // exchanges. Binance BTCUSDT, Bybit BTCUSDT and OKX BTC-USDT-SWAP are three
  // markets in one cluster: same base asset (BTC), same settlement currency
  // (USDT), so their prices are directly comparable. An arbitrage opportunity
  // is a fee-adjusted price gap between two markets of one cluster.
  //
  // Markets settling in different currencies (USD vs USDT) never share a
  // cluster: their price gap is the stablecoin spread, not arbitrage.