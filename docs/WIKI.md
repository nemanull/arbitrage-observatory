  //
  // A Cluster is a set of markets that trade the same asset on different
  // exchanges. Binance BTCUSDT, Bybit BTCUSDT and OKX BTC-USDT-SWAP are three
  // markets in one cluster: same base asset (BTC), same settlement currency
  // (USDT), so their prices are directly comparable. An arbitrage opportunity
  // is a fee-adjusted price gap between two markets of one cluster.
  //
  // Markets settling in different currencies (USD vs USDT) never share a
  // cluster: their price gap is the stablecoin spread, not arbitrage.
  //
  // An episode is the stored form of an opportunity: one row from the tick
  // that opened it to the one that closed it. It ends for exactly one of four
  // reasons, recorded on the row as closeReason.
  //   spread_collapsed: the route's own reading fell below the closure threshold.
  //   feed_down:        the socket carrying one leg closed, so the leg is no longer live.
  //   age_cap:          the episode reached the maximum age. The next tick opens
  //                     the next chunk of the same basis.
  //   shutdown:         the process stopped and flushed the open episode.
  // Silence is not a reason. Every feed is change-driven, so a leg that has not
  // printed is a leg that has not changed.
