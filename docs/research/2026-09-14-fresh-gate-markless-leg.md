# The fresh gate and a leg without a mark

Date: 2026-09-14, read during the sixth run while it was still running.
Question: the fresh gate shipped in [`../implemented/2026-09-14-fresh-edge-verdict-design.md`](../implemented/2026-09-14-fresh-edge-verdict-design.md) refuses a route whose fresh edge is under 5,000 ppm, so how did row 2624, a 1.5 percent cross on `TOWNS|USDT` bybit-coinbase, open and ride to the age cap.
Vocabulary: [`../bestiary/index-mark-and-premium.md`](../bestiary/index-mark-and-premium.md) and [`../bestiary/standing-basis.md`](../bestiary/standing-basis.md).

## 0. Method

Everything below is read from the `ArbitrageOpportunity` table on port 5532, the SigNoz logs in ClickHouse, the code under [`../../server/src/engine/opportunity/`](../../server/src/engine/opportunity/), and public REST probes against Coinbase International Exchange, Coinbase Advanced, Bybit and Kraken Futures between 20:48 and 20:58 UTC.
The process started at 20:29:38 UTC and was still writing rows at 20:58, so the run counts are a snapshot at 74 rows.

## 1. The row

Row 2624 sells on bybit `TOWNSUSDT` and buys on coinbase `TOWNS-PERP-INTX`.
It opened at 20:29:46.323, closed at 20:34:46.842 as `age_cap`, and took 44 samples.

| reading at open | value |
|---|---:|
| bybit bid, raw | 0.001870 |
| bybit index and mark | 0.001871 and 0.001871 |
| bybit fresh premium, bid over mark | -0.05 % |
| coinbase ask, raw | 0.001840 |
| coinbase index | 0.0018721 |
| coinbase mark in the poller | none |
| coinbase fresh premium, ask over index | -1.71 % |
| net ppm after fees | 15,339 |
| index gap ppm | -563 |
| carried ppm | 0 |
| fresh net ppm | 15,911 |
| standing ppm | -572 |

The arithmetic of [`anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) reproduces every stored number from the raw prices, and the three factors multiply back to the net edge to the last digit.
The gate saw a fresh edge of 15,911 ppm against a threshold of 5,000 and let the route through.
Nothing in the open gate or the close rule misfired.

## 2. Why the gate passed

Coinbase publishes no mark in the call the poller reads, so [`coinbase/anchor.ts`](../../server/src/venues/coinbase/anchor.ts) writes 0 and the reader measures the coinbase leg over its index instead.
The whole 1.71 percent discount of the coinbase ask to the coinbase index therefore lands in the fresh premium.
The design knew this, see the sentence "a leg without a mark counts as one there, and its whole premium shows in the fresh edge instead" in [`../bestiary/index-mark-and-premium.md`](../bestiary/index-mark-and-premium.md).
On a route with a coinbase leg, the fresh gate is the raw gate.

The close rule then had nothing to fire on.
The fresh series of row 2624 never went under 10,308 ppm, because the coinbase ask never moved and the bybit bid stayed within 0.1 percent of the bybit mark.

## 3. The book behind the row

The coinbase ask was one resting order of 750,455 TOWNS at 0.00184, worth 1,381 USDC.
It is the only ask level the ladder walk reached on every one of the seven TOWNS rows, it never changed inside any of them, and the discovery log shows it at every reopen from 20:29:46 to 20:51:44.
It was still the best ask on the INTX REST book at 20:48, 20:50 and on ten samples between 20:57:26 and 20:58:00.
At 20:56:45 the discovery log shows 13,311 at the ask and at 20:58:11 it shows 772,281, so the order was modified, not filled.

The book around it is dead.

| INTX `TOWNS-PERP`, 20:48 UTC | value |
|---|---:|
| best bid | 0.0016 for 125,000 |
| best ask | 0.00184 for 750,455 |
| next ask | 0.00202 for 19,801 |
| spread | 1,304 bps |
| last trade | 0.001873 |
| index | 0.001863 |
| mark | 0.00184 |
| 24 hour notional | 5,481 USDC |
| funding settled at 20:00 | -0.0262 % per hour |
| predicted funding | -0.0432 % per hour |

The Coinbase Advanced feed was healthy the whole time.
The `WS Coinbase Advanced` logger wrote one line in the window, the start line, and no resync, silence or acknowledgement warning.
The order is real, and it is the shape [`../bestiary/thin-book.md`](../bestiary/thin-book.md) describes.
A taker who lifted it would hold 750,455 TOWNS long on a book whose best bid sits 13 percent lower, paid 0.03 to 0.04 percent an hour by the shorts, against a bybit short at 0.00187.
That is a carry with no exit, not a cross.

## 4. What Coinbase International publishes as a mark

The INTX REST host answers from this machine, unlike its socket.
`GET https://api.international.coinbase.com/api/v1/instruments/{symbol}/quote` carries `mark_price`, `index_price`, `settlement_price` and `predicted_funding`, and the symbol is the Advanced product id without the `-INTX` suffix.
`GET /api/v1/instruments` returns every instrument with the same quote embedded, 131 perpetuals in `TRADING` and 133 `DELISTED`, so one call can replace the Advanced products call for index, mark and predicted funding.

Sixty samples over six instruments between 20:57:26 and 20:58:00 UTC, ten each on `BTC-PERP`, `ETH-PERP`, `LINK-PERP`, `AVAX-PERP`, `MORPHO-PERP` and `TOWNS-PERP`.

| candidate formula | samples matched |
|---|---:|
| median of best bid, best ask and last trade | 60 of 60 |
| last trade clamped into the spread | 60 of 60 |
| median of best bid, best ask and index | 39 of 60 |
| index clamped into the spread | 39 of 60 |

The INTX mark is the last trade clamped into the current spread.
Coinbase's trading rules say the mark is held within a band of the index, which the `limit_up` and `limit_down` fields at plus and minus 7 percent are, and that hourly funding is the mark's premium over the index divided by 24.
The predicted rate of -0.0432 percent an hour on TOWNS is exactly that, a mark 1.18 percent under the index divided by 24.

So the INTX mark is not a smoothed accepted premium the way the bybit and binance marks are.
It carries no averaging at all.
Fed into the reader as it is, a coinbase buy leg's fresh premium is the ask over a mark that is never above the ask, so it is never negative, and a coinbase sell leg's is never positive.
A coinbase leg can then never add fresh edge, only remove it.
On row 2624 the fresh edge with the INTX mark of 0.00184 is -1,484 ppm, and `validate` would have refused the route as `standing_basis`.

## 5. The run so far

74 rows between 20:29:46 and about 20:58 UTC, in four classes.

| class | rows | close reasons | what it is |
|---|---:|---|---|
| `LSK\|USDT` crash | 31 | 28 fresh edge, 2 spread, 1 feed down | one flash crash on bybit-binance and bybit-krakenfutures, read as lead and lag by the previous session |
| coinbase leg | 14 | 7 age cap, 7 spread | the TOWNS order above on two routes, plus six sub-second MORPHO and other rows |
| `IO\|USDT` on kraken | 8 | 8 age cap | section 6 |
| other | 21 | 18 spread, 3 fresh edge | 18 of them under one second |

- 47 of the 74 rows lived under one second, 25 of the 27 `spread_collapsed` rows among them.
  This is [`../bestiary/flicker.md`](../bestiary/flicker.md), still open as issue #12.
- Every one of the 15 age caps is a coinbase leg or a kraken leg, and on all 15 the ask side never changed for the whole five minutes.
- 28 of the 31 `fresh_edge_collapsed` closes landed within 200 ms of an anchor write, 18 within 50 ms.
  The fresh close fires when a poll lands, not when a book converges.
- The gate refused six standing routes without writing a row: `LSK|USDT` bybit-binance 95 warnings with 23,662 suppressed, and `MTL`, `STEEM`, `T`, `CVC` and `ZIL` with about a thousand suppressed each.
  No `anchor_missing`, `anchor_stale` or `anchor_skewed` refusal appears in the window, and no row opened unjudged.
  The fifth run's 89 unjudged age caps are gone.

## 6. The kraken band ride

Eight `IO|USDT` rows buy on kraken `PF_IOUSD` and sell on bybit or binance, and all eight ran to the age cap.

| kraken reading | value |
|---|---:|
| ask, raw | 0.13229, unchanged from 20:34 to 20:58 |
| index at open | 0.13343 |
| mark at open | 0.13308 to 0.13321 |
| mark over index | -0.17 to -0.26 % |
| ask over mark | -0.6 to -0.7 % |
| last trade | 18:59:07 UTC, two hours before the rows |
| 24 hour volume | 62,253 contracts |
| funding stored | +0.49 % per hour, longs pay |

The kraken mark absorbed a quarter of the book's discount and stopped there for 24 minutes, so the fresh premium of the ask kept two thirds of a standing discount.
The fresh edge at open was 5,010 to 14,056 ppm, the minimum over each series 3,157 to 5,361, and it never went under the 1,000 ppm close threshold.
Between the 5,000 ppm open and the 1,000 ppm close there is a band a marginal route sits in until the age cap, and the kraken leg sat in it for eight rows.

Kraken's absolute rate is the quote currency per contract per hour and the poller divides it by the mark, which is the venue's own definition of the relative rate up to the spot versus mark choice.
A positive rate means longs pay, so a long on kraken IO pays 0.49 percent an hour while the perp trades under its index.
That sign and size do not follow from the premium and are an open question, see section 9.

## 7. Verdict on the decision

Yes, with the caveat that the verdict is only as good as the mark it reads.

What the rule bought.
Six standing routes that would each have been a stream of five minute rows wrote nothing, the table holds no unjudged row, and the `LSK` crash closed in a median of 545 ms instead of running 300 s per row.

What it cannot see.
The gate takes each venue's mark as the accepted premium, and the five venues do not agree on what a mark is.
Coinbase supplies none in the poller, so its legs are judged on the raw premium and the gate is the raw gate there.
Kraken's mark absorbs only part of its own book's discount, so its legs keep a standing discount in the fresh edge.
The INTX mark is the clamped last trade, which absorbs everything at once and could not tell a flash from a basis.
Bybit, binance and okx marks are moving averages over 30 seconds or minutes, which is the reading the design assumed for every venue.

The 15 age caps of this run are the two venues where the assumption fails, and nothing else.

## 8. Options, smallest first

1. Refuse a leg without a mark as `anchor_missing`.
   One condition in `readLeg` in [`anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts).
   Every coinbase route is refused until a mark exists, which is the "no unjudged row" rule applied consistently.
2. Read the INTX quote for coinbase.
   One call to `/api/v1/instruments`, symbol is the product id without `-INTX`, and the poller gains a mark, the same index, and both the settled and the predicted hourly rate.
   With that mark a coinbase leg never adds fresh edge, so TOWNS is refused at -1,484 ppm, and a real coinbase flash is refused with it.
   Given 5,481 USDC of daily notional on the instrument, that is the right side to err on.
3. Close the band.
   Either close the fresh edge at the open threshold, or close once the fresh edge has sat under 5,000 ppm for a few seconds.
   The eight IO rows close in seconds instead of 300 s.
   The risk is more fragments on a fast tape, which the 28 anchor-timed closes already show.
4. Judge the fresh close on two consecutive anchor readings rather than one.
   This is the anchor age against index velocity guard the previous session suggested for the LSK rows, and it belongs with issue #12.
5. Compute the accepted premium in the engine instead of trusting the venue's mark.
   The engine holds every book, so a 30 to 60 second moving average of each slot's own touch premium over its index is one array and a few lines in `updateBook`.
   It would judge coinbase, kraken and the three others by the same reading.
   It is the structural fix, and it is a design, not a patch.

## 9. Open questions

- Kraken publishes +0.49 percent an hour on `PF_IOUSD` while the perp sits under its index and has not traded for two hours.
  The contract specification for how kraken sets the rate on a market with no trades was not found, and the API reference only names the field "the current absolute funding rate".
- The INTX documentation page that defines the mark was not located, so section 4 rests on the sixty samples and the trading rules text.
- Whether a kraken mark ever converges on a dead book, or whether it sits partway by construction, needs a longer read than 24 minutes.

## Evidence

- Rows 2624, 2625, 2628, 2637, 2644, 2647, 2654 for TOWNS and 2627, 2629, 2636, 2642, 2643, 2646, 2653, 2668 for IO in `ArbitrageOpportunity`, columns `freshNetPpmSeries`, `lowestAskSeries`, `anchorTsMs`, `lowestAskIndexSeries`, `lowestAskMarkSeries`.
- `opportunity_rejected` and `Opportunity found` lines in `signoz_logs.distributed_logs_v2` from 20:29 UTC, contexts `OpportunityManager` and `WS Coinbase Advanced`.
- INTX probes: `/api/v1/instruments/TOWNS-PERP/quote`, `/api/v1/instruments/TOWNS-PERP`, `/api/v1/instruments`, and the sixty quote samples at 20:57 UTC.
- Coinbase Advanced probes: `/api/v3/brokerage/market/products/TOWNS-PERP-INTX` and `/api/v3/brokerage/market/product_book?product_id=TOWNS-PERP-INTX` at 20:48 UTC.
- Kraken `/derivatives/api/v3/tickers` at 20:58 UTC for `PF_IOUSD`, `PF_LSKUSD`, `PF_XBTUSD` and `PF_ETHUSD`.
- Bybit `/v5/market/tickers?category=linear&symbol=TOWNSUSDT` at 20:46 UTC.
