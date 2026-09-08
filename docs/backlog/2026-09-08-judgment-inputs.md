# Inputs the judgment does not have

Status: Not started.
Recorded: 2026-09-08.
Indexed in [BACKLOG.md](../BACKLOG.md).
GitHub issues: [#3](https://github.com/nemanull/arbitrage-observatory/issues/3) index, mark and funding, [#4](https://github.com/nemanull/arbitrage-observatory/issues/4) per leg age, [#5](https://github.com/nemanull/arbitrage-observatory/issues/5) underlying session, [#6](https://github.com/nemanull/arbitrage-observatory/issues/6) tradability limits, [#15](https://github.com/nemanull/arbitrage-observatory/issues/15) venue status.

## Finding

The engine decides that a row is an opportunity from two numbers, the fee adjusted best bid on one venue and the fee adjusted best ask on another.
That test was true on every one of the fourth run's 597 rows, and it could not tell apart a standing basis, an equity perp on a closed market, a ten dollar order on a venue with no takers, a flash that lived 80 ms, and a dead market.
The reason is not a bug in the test.
The inputs that separate those five cases are not read anywhere in the system, so no rule could use them.
This entry explains each missing input, what it would have said on the fourth run, where it comes from, and what carrying it means.
The evidence is in [`../research/2026-09-08-fourth-run-data-audit.md`](../research/2026-09-08-fourth-run-data-audit.md).

## 1. Index, mark and funding per leg

A perpetual's price is anchored to its index by funding.
When two perps on the same asset trade apart, the gap is either an arbitrage that will close within seconds, or a basis that one venue's index composition or funding regime holds open, and only the legs' index, mark and funding tell which.

On the fourth run this was 352 rows.
SOPH okx traded 0.35 to 1.3 percent under bybit and binance for the whole run and two hours after it, with the three indices agreeing within 0.29 percent, because the okx perp sat 1.31 percent under its own index while the others sat 0.5 to 0.85 percent under theirs.
CP okx traded 0.5 to 2.4 percent under bybit while bybit's predicted funding was -2.0 percent per four hours and okx's -1 percent, so the trade that sells bybit and buys okx paid more funding than it received.
HEMI's binance wallet was closed and its index was 74 percent binance's own isolated spot, the ONE mechanism of the second audit with a 0.14 percent index gap instead of 5 percent.

Where it comes from: binance `premiumIndex` and `fundingInfo`, bybit `tickers` and `instruments-info`, okx `index-tickers`, `mark-price`, `funding-rate` and `index-components`, kraken `tickers`.
Coinbase has no public index for its perps.

Traps: read both legs inside one second, since a three minute skew fabricated 0.6 to 0.9 percent gaps on IOST, CATI and HAEDAL.
Filter on venue status first, since binance ICXUSDT is `SETTLING` and still publishes an index.
Compare funding per interval and per day in the trade's direction, since intervals are 4 h, 8 h or hourly and caps are 2.5 percent on bybit and 1 percent on okx.

On the row: each leg's index, mark, premium, funding rate and interval at open, peak and close, the index gap in ppm, and the net funding per day in the trade's direction.
At cluster build: deny or tag when the indices disagree beyond a threshold, which replaces the hand kept `DENIED_PAIRS` list.

## 2. Per leg age

Every book channel is change driven, so a leg that stopped changing and a leg whose socket stopped delivering it are both silent.
`writtenAt` is written and zeroed but never read, and `recvTs` is only tested for zero.
Binance `depth20@100ms` was measured at zero identical consecutive frames and a 9.8 s gap on a quiet market.

On the fourth run okx's ISRG ask did not move for 300 s on three rows, binance's BNC ask changed seven times in 14 minutes while bybit's moved through 139 values, a coinbase connection stalled for 16 s before the silence watch killed it, and row 1251 reports 300,665 ms of duration from four samples inside 59 ms.
Nothing on the row shows any of this.

On the row: the other leg's age at open, peak and close, the venue's own timestamp per frame, a `stale_leg` tag past a per venue tolerance, and which leg opened, ticked and closed the episode.

## 3. Underlying session

A tokenised equity perp has no price discovery while its underlying is closed.
Its index becomes its own last price, a single data vendor's ticker, or a feed reporting -1, and two venues drift apart for hours.

On the fourth run this was 37 rows.
BNC is CEA Industries, a NASDAQ stock, and bybit ran 2.8 to 3.3 percent above binance for ten minutes on real depth in Tuesday pre-market after Labor Day.
With the market open the two marks were 0.02 percent apart.
ISRG's two indices were bybit's last price and one Ondo ticker, and all seven rows ran to the age cap.
A wallet lookup by coin symbol returns Bifrost for BNC, so identity has to come from the venue's instrument metadata.

Where it comes from: bybit `symbolType`, `marketRegion` and `underlyingTicker`, binance `underlyingType` and `underlyingSubType`, okx `instFamily`, and an exchange calendar with holidays.

On the row: an equity tag and the underlying's session state at open.

## 4. Tradability limits

A crossing region is only an opportunity if an order can take it.
Nothing in the cluster knows the minimum quantity, quantity step, minimum notional, maximum market order size or price band on either leg.

On the fourth run okx ISRG rows reported 110 to 861 dollars of region against a 4.4 share market order cap, coinbase rows reported ten dollar regions that sit under most venues' minimum notional, and bybit SOPH orders step in tens of coins.
Live values: bybit `minOrderQty`, `qtyStep` and `minNotionalValue`, binance `MIN_NOTIONAL` and `PERCENT_PRICE`, okx `lotSz`, `maxMktSz` and `floatPxLmtPct`, coinbase `quote_min_size`.

On the row: the region capped at the smaller leg's maximum market size, whether it clears both minimum notionals, and the settlement asset per leg.

## 5. Venue participation and liquidity

A resting order that nobody takes for minutes is a fact about the venue, not about the price.
On coinbase INTX, AERO held 8 bids and 7 asks in total, traded 25,500 dollars a day in ten dollar prints, and a coinbase ask 3 percent under binance's bid sat untaken for 143 s.
On kraken, CRO traded 3,540 dollars a day and ICX sat 13.7 percent wide.
These venues produced 83 rows whose prices were real and whose fills were impossible.

Where it comes from: 24 h volume and open interest from each venue's ticker, the trade rate and median print size from the tape, and the venue's own market status.

On the row: 24 h notional and open interest per leg, and a participation tag.

## What finishing means

Each input is its own GitHub issue above, and together they replace the hand kept lists in `server/src/engine/clusterOverrides.ts` with a classification the row carries.
The order of value on the fourth run's evidence is index and funding first (352 rows), then session (37 rows), then a minimum region and participation (83 rows), then per leg age and tradability, which sharpen every class.
