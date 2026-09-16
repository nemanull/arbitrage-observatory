# Wiki

The vocabulary the rest of this tree uses.
Definitions only.
The mechanisms behind them live in [`bestiary/`](./bestiary/), and the numbers live in [`audits/`](./audits/).

## Market

One venue's listing of one contract, spelled exactly as that venue's socket spells it.
Binance `BTCUSDT` and OKX `BTC-USDT-SWAP` are two markets.

## Pair

A base asset and a settlement asset, written `BTC|USDT` and called a PairKey.

USD, USDC and USDT count as one settlement asset.
Kraken `PF_XBTUSD` and Coinbase `BTC-PERP-INTX` therefore sit in the `BTC|USDT` cluster, because the stablecoin basis is normally under 100 ppm against a 5,000 ppm opening threshold.
A venue that lists a USDC or inverse twin next to its USDT linear contributes the USDT linear only.
Any other quote, such as BTC, stays its own cluster.

## Cluster

The set of markets that trade the same pair on different venues.
Binance `BTCUSDT`, Bybit `BTCUSDT` and OKX `BTC-USDT-SWAP` are three markets in one cluster, so their prices are directly comparable.

## Route

An ordered pair of venues within one cluster, written `bybit-binance`.
The first venue is the one we sell on and the second is the one we buy on.

## Opportunity

A price gap between two markets of one cluster that still pays after both taker fees.
The reading is in parts per million of the buy price, so 5,000 ppm is half a percent.

## Episode

The stored form of an opportunity.
One row covers the whole life of a route, from the tick that opened it to the tick that closed it, not a single moment.

An episode ends for exactly one of five reasons, recorded on the row as `closeReason`.

| Reason | Meaning |
| --- | --- |
| `spread_collapsed` | The route's own reading fell below the closure threshold. |
| `fresh_edge_collapsed` | The fresh edge fell below the closure threshold while the raw cross still cleared it. |
| `feed_down` | The socket carrying one leg closed, so the leg is no longer live. |
| `age_cap` | The episode reached the maximum age, and the next tick opens the next chunk of the same gap. |
| `shutdown` | The process stopped and flushed the open episode. |

Silence is not a reason.
Every feed is change-driven, so a leg that has not printed is a leg that has not changed.

## Anchor

The three numbers a venue publishes about its own perpetual: the index, the mark and the funding rate.
They are polled over REST once a second, separately from the book sockets.
[`bestiary/index-mark-and-premium.md`](./bestiary/index-mark-and-premium.md) is the full account of what each one is and how fast it moves.

## Fresh edge and standing basis

A cross is split into the part the two venues' own anchors already explain and the part they do not.

The standing part is a gap the market is holding open on purpose, because each perpetual is chained to its own venue's index and nothing chains the two perpetuals to each other.
The fresh part is what is left once each book is divided by its own venue's anchor, and it is the only part a taker cross can capture.
[`bestiary/standing-basis.md`](./bestiary/standing-basis.md) shows the class this distinction was built to remove.

## Region

The whole span of the two books that still crosses after fees, found by walking both ladders level by level rather than reading the touch.
A region has an average edge in ppm and a size in quote units.
[`bestiary/edge-at-the-touch.md`](./bestiary/edge-at-the-touch.md) explains why the touch alone overstates both.
