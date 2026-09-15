# Standing basis

A gap between two perps that the market is holding open on purpose.
Both books are deep, both prices are real, and the trade the row implies never converges.
Each perp is chained to its own venue's index, and nothing chains the two perps to each other.

## The row

Rows 791 and 805 of the fourth run, from [`../audits/2026-09-08-fourth-run-data-audit.md`](../audits/2026-09-08-fourth-run-data-audit.md).

| field | row 791 | row 805 |
|---|---|---|
| pair | `SOPH\|USDT` | `SOPH\|USDT` |
| route | binance-okx | binance-okx |
| opened | 04:58:11.219 UTC | 05:03:11.263 UTC |
| closed | 05:03:11.263 UTC | 05:08:11.282 UTC |
| duration | 300,044 ms | 300,019 ms |
| ticks | 5,403 | 5,112 |
| net ppm at open | 5,383 | 8,231 |
| net ppm at close | 8,231 | 7,807 |
| peak net ppm | 12,987 | 11,846 |
| peak region | $5,715 at 11,086 ppm, a book exhausted | $9,507 at 9,812 ppm, a book exhausted |
| close reason | `age_cap` | `age_cap` |

Row 805 opens in the millisecond that row 791 closes, at the net ppm that row 791 closed on.
Nothing happened at 05:03:11.263 except the engine's five minute age cap.

The bybit-okx route ran the same chain, rows 793 and 806, opening at 04:58:11.722 and closing at 05:08:12.073.
The cross that opened at 04:58 was still open at 06:45 when the audit read the books by hand, and still open two hours after the run ended.

Over the whole run the okx ask sat 0.35 to 1.3 percent under the binance and bybit bids, with thousands of dollars resting on both sides.
A ranking by ppm puts this first.
A ranking by notional puts this first.
It is 256 of the run's 597 rows, and not one of them was an arbitrage.

## What a perp is anchored to

A perpetual never expires, so nothing forces its price to spot.
Each venue chains its perp to an index instead.

The index is a basket, but a basket of prices for one asset, not a basket of assets.
The venue picks a few spot markets for that asset, weights them, and publishes the average.
Every hour, four hours or eight hours the venue moves funding from longs to shorts, or from shorts to longs, in proportion to how far the perp sits from that index.
The mark price is the index plus a smoothed premium, and it is what liquidations use.

The word that matters is *own*.
Binance's SOPH perp is pulled toward Binance's SOPH index.
OKX's SOPH perp is pulled toward OKX's SOPH index.
Nothing pulls the two perps toward each other.
The four numbers, how each is built, and how fast each moves are described in full in [`index-mark-and-premium.md`](./index-mark-and-premium.md).

So when two perps on the same asset trade apart there are two explanations.
The anchors agree and the gap is a dislocation that closes within seconds, which is an arbitrage.
Or the gap is held open by the anchors themselves, which is a basis.
Selling the expensive perp and buying the cheap one locks in a basis and never realises it.

Four runs have produced three shapes of basis.

## Different anchors: ONE

The cleanest case is Harmony ONE on binance and okx, the largest row source of the first and second runs.

Each venue publishes the basket behind its index.
Read on 2026-09-09 at 04:19 UTC.

| binance ONEUSDT index | weight | price |
|---|---:|---|
| binance_future ONEUSDT, the perp itself | 100 % | 0.0006961 |

| okx ONE-USDT index | weight | price |
|---|---:|---|
| OKX spot | 33.3 % | 0.000660 |
| Binance spot | 33.3 % | 0.000703 |
| Kucoin spot | 16.7 % | 0.000653 |
| Gate spot | 16.7 % | 0.000654 |
| index | | 0.0006611 |

Binance's index for its ONE perp is the ONE perp, at weight one, and its funding is pinned at a cap of 0.005 percent per eight hours.
Nothing outside binance can move that anchor.
OKX's anchor is a four venue average of spot.

The spot venues disagree because ONE deposits and withdrawals are closed on binance, kucoin and gate.
That was verified on 2026-09-06 and again on 2026-09-09, when kucoin reported the ONE chain with deposits and withdrawals disabled and gate reported it disabled outright.
Nobody can buy ONE on kucoin at 0.000653 and sell it on binance at 0.000702, because the coin cannot travel.
Binance spot sits 7.3 percent above kucoin, and binance's perp follows binance's spot.

A same second read of both legs at 04:21:35 UTC.

| | binance | okx |
|---|---|---|
| index | 0.0006957 | 0.0006616 |
| mark | 0.0006946 | 0.0006625 |
| perp bid and ask | 0.0006957 and 0.0006959 | 0.0006624 and 0.0006626 |
| mark over index | -0.15 % | +0.14 % |

The two anchors sit 5.15 percent apart.
The binance bid over the okx ask is 5.00 percent.
The whole quoted gap is the anchor gap.

Measured against its own anchor, each perp is within 0.15 percent of where its venue wants it.
The leg the trade sells, binance, is the one under its anchor, and the leg it buys, okx, is over its anchor.
So the trade sells the cheap one and buys the dear one, relative to what each venue will pull toward.

The ratio was 1.051 on 2026-09-05, 1.053 on 2026-09-06 and 1.0515 on 2026-09-09.
Four days is not a dislocation.

HEMI in the fourth run is the same mechanism at a smaller scale.
Binance's HEMI wallet is closed on every network, binance spot HEMI trades 2.1 percent above gate and mexc, and binance's index is 74 percent its own spot.
But bybit's HEMI basket is 83 percent binance spot too, so the two anchors sit only 0.14 percent apart and the perps still converge.
The mechanism alone does not condemn a pair.
The size of the anchor gap does.

## Same anchor, one perp held off it: SOPH

SOPH is the row above, and its anchors agree.

| venue | basket, read 2026-09-09 |
|---|---|
| binance | binance 54 %, okx 16 %, kucoin 8 %, mexc 8 %, bitget 8 %, gate 5 % |
| bybit | binance 55 %, gate 25 %, okx 16 %, kucoin 2 %, mexc 2 % |
| okx | binance 33 %, okx 33 %, bitget 17 %, gate 17 % |

Three different sets of proportions and one number.
The three indices agreed within 0.29 percent during the run and within 0.21 percent on 2026-09-09, because SOPH can move between venues and spot arbitrage keeps the spot markets together.

The perps did not agree with their anchors.
At 06:36 on 2026-09-08 the okx perp sat 1.31 percent under its own index, binance 0.85 percent under and bybit 0.5 percent under.
The cross between okx and the other two was okx's deeper discount, and nothing else.

What holds a perp 1.3 percent under its own index for hours is funding.
OKX's predicted rate for 08:00 was -0.381 percent per four hours, which means shorts paid longs 0.381 percent every four hours to keep the discount.
Bybit's was -0.156 percent and binance's -0.081 percent.
A pair that is long okx and short bybit receives the okx rate and pays the bybit rate, about 0.22 percent per interval.

That is a carry trade with a horizon of hours, and it converges when funding changes.
It did.
After 08:00 bybit and binance moved SOPH to hourly settlement at their -2 percent cap while okx stayed at -1 percent.
The short bybit leg now paid 2 percent per hour, the carry reversed sign, and by 19:01 the cross no longer cleared fees.

The row shows a 0.5 to 1.3 percent price gap.
The trade behind it was a funding bet whose sign flipped six hours later.

## Carry against the trade: CP

CP was four days old on bybit and six on okx, and both perps sat far under the 0.0218 index, bybit's mark 2.9 percent under and okx's 6.0 percent under.
Bybit's predicted funding was -2.0 percent per four hours, and okx's sat at its -1 percent floor.

The engine's trade sells bybit and buys okx.
Short bybit pays 2.0 percent, long okx receives 1.0 percent, and the pair bleeds 1.0 percent per interval.
The 2 percent gap at the touch was eight hours of carry.
The 08:00 settlement realised -1.17 percent on bybit and -0.94 percent on okx, a 0.23 percent bleed for that one interval.

Row 1271 ran 300 seconds to the age cap with a $3,093 region at 3,801 ppm.
The 86 CP rows have a mean peak of 8,467 ppm, and every one of them describes a position that loses money while it waits.

## Why the engine could not see it

Until 2026-09-10 the engine decided from two numbers: the fee adjusted best bid on one venue and the fee adjusted best ask on another.
No index, mark or funding field existed on `Market`, `Cluster` or `Opportunity`, and the cluster builder read only the market list from ccxt.
The inputs that separate a basis from an arbitrage were not read anywhere in the process, so no rule could use them.

A basis never collapses, so the row ran to `MAX_OPPORTUNITY_AGE_MS`, closed as `age_cap`, and reopened on the next tick.
The 1,000 ppm closure threshold sits inside the noise of a 6,000 ppm basis, so 231 SOPH rows sit in 58 sequences that close and reopen within two seconds.

The age cap is a symptom, not the cause.
Raising it turns a five minute row into a two hour row.

Depth makes it worse, not better.
The ladder walk in [`edge-at-the-touch.md`](./edge-at-the-touch.md) finds thousands of dollars on both sides of a basis, because both books are honest.
A row that reports the largest region in the table is the row this class produces.

The answer at the time was the hand kept `DENIED_PAIRS` list in [`../../server/src/engine/cluster/clusterOverrides.ts`](../../server/src/engine/cluster/clusterOverrides.ts).
It reached eight pairs and grew by a few every run, because denial is by name and the cause is a mechanism.

## How to detect it

Read each leg's anchor on every sample, and split the cross into the part the anchors explain and the part they do not.
The vocabulary is in [`index-mark-and-premium.md`](./index-mark-and-premium.md), and the reader is [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts).
In fractions, 1 + netPpm = (1 + indexGapPpm) × (1 + carriedPpm) × (1 + freshNetPpm).

1. The index gap between the legs, in ppm, after the venue price scales.
   ONE at 5.15 percent is this part.
2. The carried part, the gap between the two legs' premiums, where a premium is mark over index minus one.
   SOPH at -1.31 percent against -0.5 percent is this part.
3. The fresh edge, each book divided by its own mark, after fees.
   It is the part a taker cross can capture.

A route opens only when its anchors can be read and both the raw cross and the fresh edge clear 5,000 ppm.
A cross that the index gap and the premiums explain is refused as `standing_basis` and writes no row.
An open route closes as `fresh_edge_collapsed` once its fresh edge falls under 1,000 ppm, even while the raw cross still clears it.
A route whose indices disagree is not set aside on its own, because a fresh edge on top of an index gap can still close.
Funding is copied onto the row and not filtered on, because the modelled trade crosses no settlement and the premium the gate removes is what funding is already pricing.

On 2026-09-15 a live probe found every crossed OPENAI, ANTHROPIC and ONE route refused this way in 90 of 90 rounds, with raw crosses up to 41,139 ppm and no fresh edge above 344 ppm, see [`../research/2026-09-15-denied-basis-pairs-gate-probe.md`](../research/2026-09-15-denied-basis-pairs-gate-probe.md).
Those three pairs, ONG and SIREN left `DENIED_PAIRS` that day.

Where each number comes from.

| venue | index, mark, funding | interval and caps | basket |
|---|---|---|---|
| binance | `/fapi/v1/premiumIndex` | `/fapi/v1/fundingInfo` | `/fapi/v1/constituents` |
| bybit | `/v5/market/tickers?category=linear` | `/v5/market/instruments-info` | `/v5/market/index-price-components?indexName=` |
| okx | `/api/v5/market/index-tickers`, `/api/v5/public/mark-price`, `/api/v5/public/funding-rate` | `/api/v5/public/funding-rate` | `/api/v5/market/index-components?index=` |
| krakenfutures | `/derivatives/api/v3/tickers` | | not published |
| coinbase | `https://api.international.coinbase.com/api/v1/instruments`, index, mark and the predicted rate for every perp in one call | the same call | not published |

The basket is a diagnostic, not an input.
The index gap already says whether the anchors differ, and the basket says why.

ccxt covers part of this.
`fetchFundingRate` is unified on binance, bybit, okx and krakenfutures, and on binance and bybit it returns `indexPrice` and `markPrice` alongside the rate.
It is not implemented for coinbase, whose index and funding come from the products call above.
On okx it returns the rate and interval only, so mark and index need `fetchMarkPrice` and the index ticker.
No unified call returns a basket, but every raw endpoint above is reachable as an implicit method, for example `fapiPublicGetConstituents`, `publicGetMarketIndexComponents` and `publicGetV5MarketIndexPriceComponents`.
The first unified call on a fresh instance loads the market list and took 2.3 seconds across three venues, so the reads that matter should not go through it.

Traps found while probing.

- Read both legs inside one second.
  A three minute skew between the binance and bybit reads fabricated 0.6 to 0.9 percent index gaps on IOST, CATI and HAEDAL, and a same second read gave 0.07, -0.05 and -0.02 percent.
- Filter on venue status first.
  Binance ICXUSDT is `SETTLING` and still publishes an index 1 to 4 percent off the market, and 130 symbols were `SETTLING` on 2026-09-08.
- An off hours equity index is not an index.
  Bybit's ISRG index equalled its own last price and okx's was one data vendor's ticker, 0.85 percent apart, and both became real composites when NASDAQ opened.
- Intervals and caps differ.
  SOPH settled every four hours on bybit and binance before 2026-09-08 08:00 and hourly after, and caps differ by venue and symbol, 2.5 percent on bybit CP and 1 percent on okx, so compare per interval and per day in the trade's direction.
- Predicted and realised rates diverge.
  Bybit CP predicted -2.006 percent and realised -1.17 percent.

The work was [issue #3](https://github.com/nemanull/arbitrage-observatory/issues/3), closed on 2026-09-15.

## How common it was

| run | pairs | rows | share |
|---|---|---:|---:|
| first, 2026-09-05 | ONE | 71 | 14.5 % |
| second, 2026-09-06 | ONE | 240 | 18.6 % |
| third, 2026-09-06 | OPENAI 37, ANTHROPIC 33, ONG 33, SIREN 27 | 130 | 17.4 % |
| fourth, 2026-09-08 | SOPH 256, CP 86, HEMI 10 | 352 | 59.0 % |

After each run the pairs were denied by name, and the next run found new ones.
The class did not shrink, because the list named pairs and the cause is a mechanism that any thin listing can produce.
The open gate now refuses the class by that mechanism, and on 2026-09-15 the list went back to the tickers that name two different tokens.
ONE returned to the list the same day for a different reason.
Binance's ONE index basket is the binance perp itself, so its mark trails the perp and the fresh edge on that leg reads the perp's own momentum, see [`../research/2026-09-15-one-self-index-fresh-gate.md`](../research/2026-09-15-one-self-index-fresh-gate.md).

## Related

- [`index-mark-and-premium.md`](./index-mark-and-premium.md) is the vocabulary this entry rests on.
- [`slow-venue-resting-order.md`](./slow-venue-resting-order.md) is the other honest row that is not free money, for a different reason.
- [`edge-at-the-touch.md`](./edge-at-the-touch.md) is the walk that makes a deep basis look like the most capturable row in the table.
- [`thin-book.md`](./thin-book.md) is the opposite shape, one order rather than a market.

## Evidence

- SOPH, CP and HEMI: sections 2a to 2c of [`../audits/2026-09-08-fourth-run-data-audit.md`](../audits/2026-09-08-fourth-run-data-audit.md), and the live probes in section 9.
- ONE and the index cross check: section 2a of [`../audits/2026-09-06-second-run-data-audit.md`](../audits/2026-09-06-second-run-data-audit.md).
- ONE's baskets and the admission gate: sections 2c(iii) and 2d of [`../audits/2026-09-05-first-run-data-audit.md`](../audits/2026-09-05-first-run-data-audit.md).
- OPENAI, ANTHROPIC, ONG and SIREN: section 4 of [`../audits/2026-09-06-third-run-data-audit.md`](../audits/2026-09-06-third-run-data-audit.md).
- The open gate on OPENAI, ANTHROPIC, ONG, SIREN and ONE: [`../research/2026-09-15-denied-basis-pairs-gate-probe.md`](../research/2026-09-15-denied-basis-pairs-gate-probe.md).
- The missing inputs: [`../backlog/2026-09-08-judgment-inputs.md`](../backlog/2026-09-08-judgment-inputs.md) and [`../backlog/2026-09-07-standing-basis-classification.md`](../backlog/2026-09-07-standing-basis-classification.md).
- The baskets, the same second ONE read and the wallet status: live probes on 2026-09-09 between 04:19 and 04:24 UTC against binance `constituents` and `premiumIndex`, okx `index-components`, `index-tickers`, `mark-price` and `funding-rate`, bybit `index-price-components` and `tickers`, kucoin `currencies/ONE` and gate `wallet/currency_chains`.
- The stored rows: `ArbitrageOpportunity` ids 791, 793, 805, 806 and 1271, fourth run, local database.
