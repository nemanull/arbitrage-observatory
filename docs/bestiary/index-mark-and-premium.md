# Index, mark and premium

The three numbers a venue publishes next to every perpetual, and the fourth one, funding, that gives them teeth.
Every entry that talks about a basis or a carry rests on these, and [`standing-basis.md`](./standing-basis.md) is the failure they explain.
This page is the vocabulary.
It says what each number is, how the venue builds it, how fast it can move, and what the observatory does with it.

## A perp needs an anchor

A dated future has an expiry, and on that day it settles at the spot price, so its price cannot wander far.
A perpetual never expires.
Nothing mechanical pins it to the coin it is named after.
Its price is whatever the last trade on its own order book was, and that book is moved by people who want leverage, not by people who want the coin.

So the venue builds the pin itself, out of three parts.
It publishes an index, which is its own estimate of what the coin is worth.
It publishes a mark, which is the price it uses to settle accounts.
And it charges funding, a periodic cash transfer between longs and shorts that punishes whichever side is holding the perp away from the index.

The picture that holds all four together is a thermostat.
The perp's traded price is the room temperature, set by whoever is trading.
The index is the thermostat setting, set by the venue from readings taken outside the room.
The premium is the difference between the two.
Funding is the heater or the air conditioner, and it runs in proportion to that difference, with the bill going to the side that is pushing the room away from the setting.
The mark is a slow thermometer, so that a draught from an open door does not trip the breaker.

## Index

The index is the venue's answer to "what is this coin worth right now, ignoring my own perp".

It is a basket, but a basket of prices for one asset, not a basket of assets.
The venue picks a few spot markets for the coin, weights them, and publishes the average.
Spot is the market where the coin itself changes hands, and it is a separate order book from the perp, even on the same venue.

Here is the recipe behind OKX's SOPH perp, read on 2026-09-09 at 04:19 UTC.

| spot market | weight | price |
|---|---:|---|
| Binance SOPH/USDT | 33.3 % | 0.005270 |
| OKX SOPH/USDT | 33.3 % | 0.005263 |
| Bitget SOPH/USDT | 16.7 % | 0.005266 |
| Gate SOPH/USDT | 16.7 % | 0.005268 |
| index | | 0.005266 |

Four spot books, three of them on other exchanges.
The perp's own book is not in the list.
At that second OKX's SOPH perp had a mark of 0.005249, a third of a percent under what the coin was trading for.

Every venue has its own recipe for the same coin.

| venue | SOPH basket, read 2026-09-09 |
|---|---|
| binance | binance 54 %, okx 16 %, kucoin 8 %, mexc 8 %, bitget 8 %, gate 5 % |
| bybit | binance 55 %, gate 25 %, okx 16 %, kucoin 2 %, mexc 2 % |
| okx | binance 33 %, okx 33 %, bitget 17 %, gate 17 % |

Three sets of proportions, one number.
The three indices sat within 0.21 percent of each other, because SOPH can be moved between exchanges and spot arbitrageurs keep the spot books together.
The proportions do not matter while the ingredients agree.

They stop agreeing when the coin cannot travel.
Harmony ONE deposits and withdrawals were closed on binance, kucoin and gate on 2026-09-06 and still on 2026-09-09.
Nobody can buy ONE on kucoin at 0.000653 and sell it on binance at 0.000702, so binance spot sits 7 percent above the rest, and the recipes diverge.

| ONE index on 2026-09-09 | recipe | value |
|---|---|---|
| binance | the binance ONE perp itself, weight 100 % | 0.0006957 |
| okx | OKX spot 33 %, Binance spot 33 %, Kucoin spot 17 %, Gate spot 17 % | 0.0006616 |

Binance's index for its ONE perp is the ONE perp, so it is comparing itself to itself and there is no outside anchor at all.
The two indices sit 5.15 percent apart.
That gap was 5.1 percent on 2026-09-05 and 5.3 percent on 2026-09-06.
The two perps follow their own settings and never meet, which is the first shape in [`standing-basis.md`](./standing-basis.md).

How fast it moves.
The venue recomputes the index about once a second from the latest spot prints.
It is a price, so it moves with the market, and that is the trap.
Two indices read three minutes apart contain three minutes of the whole market moving, and on 2026-09-08 that skew fabricated 0.6 to 0.9 percent gaps on IOST, CATI and HAEDAL where a same second read gave 0.07, -0.05 and -0.02 percent.
Read both legs in the same second, always.

## Premium

The premium is how far the perp sits from its anchor.

```
premium = perp price / index price − 1
```

Positive means the perp trades above its index.
Negative means below, which traders also call a discount, but the field is still called premium and the sign carries the meaning.
Older futures traders call the same quantity the basis.
In these entries, premium is one perp against its own index, and basis is a cross-venue gap that refuses to close.

It is not applied to anything.
It is measured, and it exists on every perp every second.
Binance, read on 2026-09-09 at 04:58 UTC.

| perp | index | mark | premium |
|---|---|---|---:|
| BTC | 79,182.32 | 79,150.26 | -0.040 % |
| ETH | 2,509.56 | 2,508.63 | -0.037 % |
| SOL | 104.413 | 104.368 | -0.042 % |
| SOPH | 0.0052877 | 0.0052810 | -0.127 % |
| ONE | 0.0006968 | 0.0006971 | +0.040 % |

BTC, ETH and SOL are what an anchored perp looks like.
A few hundredths of a percent, because the room is at the setting and nobody is paying to push it.
SOPH that morning was three times further out, and the previous day at 06:36 the same number on OKX was -1.31 percent.

Why a premium exists at all.
If more people want to be long with leverage than short, they bid the perp above the index.
During a dump, more people want to be short, and they hit the perp below the index.
The premium is the market price of that imbalance.

Why a premium can stand for hours.
Because someone is willing to pay for it, through funding.
On SOPH on 2026-09-08 OKX's shorts paid longs 0.381 percent every four hours to hold the perp 1.31 percent under its index.
As long as enough shorts believed the dump had further to go, they paid, and the discount stayed.
Funding does not remove a premium.
It prices one.

The one idea that makes premiums useful is that there are three readings of it, at three speeds.

| reading | what over the index | speed |
|---|---|---|
| instantaneous | the last trade or the best quote | every tick |
| mark premium | the mark | drifts over minutes |
| funded premium | what the funding rate is pricing | drifts over the interval |

A perp that jumps 1 percent in one frame has an instantaneous premium of 1 percent and a mark premium of nearly nothing.
Nobody has accepted the move.
A perp that has sat 1.3 percent under its index for two hours has all three readings agreeing.
The market has accepted it and is charging for it.
That difference is the whole detection rule in [`standing-basis.md`](./standing-basis.md).

## Mark

The mark is the venue's accounting price.
It is the index plus a smoothed copy of the premium over the last few minutes.
The exact smoothing differs per venue, and every recipe starts from the index and adds a premium averaged over minutes rather than the last print.

The mark never touches the price you trade at.
You buy and sell at the book, always.
The mark is used for exactly three things.

1. What an open position is worth on paper, and so how much margin it is using.
2. When a position is liquidated.
3. The notional that funding is charged on.

A worked example.
The index is 1.000, the perp trades at 1.000, and you buy 90 coins for 90 USDT in an account holding 100 USDT.

| | book price | mark | position on paper | selling now would give | funding notional |
|---|---|---|---|---|---|
| entry | 1.000 | 1.000 | 90.00 | 90.00 | 90.00 |
| a flash, 200 ms | 0.980 | 0.9998 | 89.98 | 88.20 | 89.98 |
| a standing discount, two hours | 0.987 | 0.987 | 88.83 | 88.83 | 88.83 |

In the flash, one large sell knocks the book down 2 percent for a fraction of a second.
The mark barely moves, because a 200 ms sample is nothing inside a minutes-long average.
The screen shows a 2 cent loss, not a 1.80 loss.
At 10x leverage the flash would have erased 20 percent of the margin at book price, and the venue would have liquidated a position on someone else's fat finger.
The mark is the shield.
But the shield covers margin, not exit.
Selling into the flash fills at the book, and the 1.80 is gone.

In the standing discount, the perp has sat 1.3 percent under its index for two hours and the moving average has caught up.
The mark equals the book.
The loss on paper is real, it is the number liquidation is checked against, and it is the notional the next settlement is computed on.
A flash cannot liquidate anyone.
A standing discount can.

Mark over index minus one is the smoothed premium, the middle row of the table above.
It is the reading the detector uses, because it says what the venue has accepted rather than what the book did in the last frame.

## Funding

Funding is rent, not a price.
It is not part of the buy or sell price and it does not go to the venue.
At the settlement instant the venue takes every open position, multiplies its notional at the mark by the rate, and moves that amount between the longs and the shorts.

```
paid or received = funding rate × position notional at the mark
positive rate: every long pays every short
negative rate: every short pays every long
```

The settlement instant is a clock time on the venue, not a market event.
An eight hour interval settles at 00:00, 08:00 and 16:00 UTC, a four hour one every four hours from midnight, and an hourly one on the hour.
At that moment the venue walks every open position once, computes the transfer, and moves the cash.
Nothing is paid between two instants.
A position opened and closed inside the interval pays nothing, and a position held across one pays the whole rate even if it was open for a second on each side.
Kraken is the exception and accrues funding continuously through the hour, realising it on the hour, so there the cost is proportional to the time held.
Every venue publishes the next instant, or lets it be derived, and the observatory stores it per leg as `nextFundingAt`.
Which positions count as open at the instant, on which clock, and how a venue announces an interval change are open questions, tracked in [issue #17](https://github.com/nemanull/arbitrage-observatory/issues/17).

The rate is the premium averaged over the interval, plus a small interest term, clamped to a cap.
That is why BTC funding hovers near 0.01 percent when its premium is near zero, and why a perp that has sat 1 percent under its index all interval settles with shorts paying about that.
The averaging is also why the rate cannot jump.
On an hourly interval one new second of data moves it by one part in 3,600 of whatever the premium just did.

Intervals and caps are per symbol and they change.
SOPH settled every four hours on bybit and binance until 2026-09-08 08:00 and hourly after, at a cap of 2 percent, while OKX stayed at 1 percent.
Bybit's CP cap was 2.5 percent.
Compare rates per interval and per day, never raw.

The rate every venue shows in its ticker is the one for the upcoming settlement, updated continuously from the running average.
Binance calls that field `lastFundingRate` anyway.
The rate that was actually charged lives in a separate history endpoint, and the two differ.
Bybit's CP predicted -2.006 percent and realised -1.17 percent at the 08:00 settlement.

How it is paid.
The amount is debited from or credited to the margin wallet in the settlement coin, and it shows as a funding fee line in the ledger.
The position itself does not change size.
With 100 USDT in the account and a 90 USDT position at 1x, a 0.5 percent settlement moves 0.45 USDT and the position stays 90 USDT.
With 10x leverage the same 90 USDT of margin controls 900 USDT of notional and the settlement moves 4.50 USDT, because the rate applies to notional and not to margin.
If the free balance cannot cover it, the venue takes it from the position's margin, which moves the position toward liquidation.

A settlement seen from a cross-venue position.
SOPH at 08:00 on 2026-09-08, short bybit and long okx, 10,000 USDT per leg, at the realised rates.

| leg | settled rate | who pays | your cash |
|---|---:|---|---:|
| short bybit | -0.27 % | shorts pay longs | -27 USDT |
| long okx | -0.46 % | shorts pay longs | +46 USDT |
| net | | | +19 USDT |

The direction of the trade decides the sign.
The same two rates with the legs reversed cost 19 USDT instead.
So the carry is always computed in the trade's direction, and per day so that venues with different intervals compare.

```
carry per day = rate on the sell leg × (24 / its interval hours)
              − rate on the buy leg  × (24 / its interval hours)
```

Positive means the position is paid to wait.
SOPH before 08:00 came to about +1.35 percent per day for the short bybit, long okx pair.
After 08:00 bybit moved to hourly settlement at its -2 percent cap, and the short bybit leg alone cost 2 percent per hour, which is 48 percent per day.
By 19:01 the cross was gone.

How big it usually is.
Binance, all 900 perps, absolute rate for the upcoming settlement, read on 2026-09-09 at 04:58 UTC.

| | rate |
|---|---:|
| median | 0.005 % |
| p90 | 0.02 % |
| p99 | 0.14 % |
| max | 0.42 % |

Nothing was above half a percent.
The 2 percent on SOPH was a capped rate during a mania.
It is rare, and it is exactly what the reading is for.

What funding means for the observatory.
For the trade the engine models, a taker crossing both books and closing within seconds, funding is zero, because no settlement is crossed.
For anything held across a settlement it is first order, and a capped rate dwarfs every gap in the table.
And as a reading rather than a cost, the rate is the evidence that a gap is being paid for, which is the difference between a basis and an arbitrage.

## How the four fit together

The engine measures the gap between two perps.
That gap decomposes into a part that is never capturable by the perp trade and a part that might be.

```
perp A / perp B  ≈  (index A / index B)  ×  (1 + premium A) / (1 + premium B)
```

The first factor is the anchor gap.
Funding pulls each perp toward its own index, so nothing ever closes it.
The second factor is the premium difference, and it closes when the premiums converge, at the speed funding drives them.
That second factor is itself two once the book's own premium is split from the mark's.
The accepted premiums' gap is what funding is pricing, and the fresh premiums' gap is what nobody has accepted yet.
The engine carries all three factors on every route, see the section on the engine below.

That gives three classes, and only the last one was the observatory built to find.

| indices | premiums | what the gap is | what to do |
|---|---|---|---|
| disagree beyond 1 to 2 % | any | two perps chained to different numbers, ONE, SIREN | deny the pair at cluster build |
| agree | explain the gap, and funding is pricing them | a carry trade with a horizon of hours, SOPH, CP | tag basis, with the carry sign |
| agree | do not explain the gap | a perp knocked off its anchor for a moment | the arbitrage candidate |

The test between the last two is fresh against standing.
Venue A trades at 1.000 with a mark of 1.000.

| venue B | gap between books | difference in mark premiums | verdict |
|---|---:|---:|---|
| a flash, book 0.980, mark 0.9998 | 2.0 % | 0.02 % | fresh, nobody has accepted it, it will snap back |
| standing, book 0.987, mark 0.987 | 1.3 % | 1.3 % | standing, the venue has accepted it and is charging for it |

The gap between books is what the engine already measures on every tick.
The difference in mark premiums is the new reading.
When the two agree the market already knows.
When the gap is much larger than the premium difference, something just moved and has not been absorbed.

## How fast each number moves, and how fresh it must be

| number | how the venue makes it | how fast it can move |
|---|---|---|
| perp bid and ask | the order book | every tick, a 1 % jump in one frame is real |
| index | an average of 4 to 8 spot prices, recomputed about once a second | once a second, by a fraction of what any one spot venue moved |
| mark | the index plus a moving average of the premium | drifts, cannot jump on a tick by construction |
| funding rate | the premium averaged over the interval | drifts more slowly, republished about once a minute |

Two rules follow.
Each leg's reading can be as old as the venue's own cadence, about a second, because nothing the venue publishes moves faster than that.
The two legs must be from the same instant, because the index gap is a difference of two prices and any skew leaks market movement into it.
Polling per tick returns the same numbers over and over and makes no average fresher.

## Where each number comes from

One request per venue returns every perp, and all five together took about a second in parallel on 2026-09-09.

| venue | one call for every perp | perps | index | mark | rate and next settlement | interval and cap |
|---|---|---:|---|---|---|---|
| binance | `/fapi/v1/premiumIndex` | 900 | yes | yes | yes | `/fapi/v1/fundingInfo` |
| bybit | `/v5/market/tickers?category=linear` | 866 | yes | yes | yes | same call |
| okx | `/api/v5/public/funding-rate?instId=ANY`, `/api/v5/public/mark-price?instType=SWAP`, `/api/v5/market/index-tickers` | 645 | yes | yes | yes, plus the realised rate | same call |
| krakenfutures | `/derivatives/api/v3/tickers` | 279 | yes | yes | yes, plus a prediction | |
| coinbase | `/api/v3/brokerage/market/products?product_type=FUTURE&contract_expiry_type=PERPETUAL` | 131 | yes | no | yes | same call |

The baskets are separate calls and they are a diagnostic, not an input.
Binance `/fapi/v1/constituents`, okx `/api/v5/market/index-components?index=`, and bybit `/v5/market/index-price-components?indexName=`.
Kraken and coinbase publish none.

Bybit, okx and kraken also stream these over their public sockets, and one bybit connection carried sixty ticker topics.
Binance's documented mark price streams were accepted by the server on 2026-09-09 and delivered nothing in ten seconds, inside and outside the sandbox, while the book streams on the same connection delivered thousands of frames.
Treat the binance stream as unavailable until it is probed again, and poll.

## In the engine

The block lives on every cluster as `anchor`, one slot per venue, in [`../../server/src/engine/cluster/types.ts`](../../server/src/engine/cluster/types.ts).

| column | meaning |
|---|---|
| `index` | the venue's index price, 0 = never read |
| `mark` | 0 = the venue publishes none, which is coinbase |
| `fundingRate` | the rate for the upcoming settlement as a fraction, -0.0038 = shorts pay longs 0.38 % |
| `fundingIntervalHours` | 1, 4 or 8 |
| `nextFundingAt` | Unix ms, 0 = unknown |
| `writtenAt` | Unix ms, 0 = never, and a reader refuses two legs further apart than two and a half seconds, since bybit polls every two seconds |

Premium is not a column.
It is computed when a reading is taken, the way the fee multipliers are applied at read and never at write, by one helper, `premium(price, reference)`, which is the price over the reference minus one.
A leg read at open carries three of them.
The touch premium is the book price the trade uses over the index, the mark premium is the mark over the index, and the fresh premium is that book price over the mark, or over the index where the venue publishes no mark.

`Engine.updateAnchor` in [`../../server/src/engine/Engine.ts`](../../server/src/engine/Engine.ts) writes a slot from one poll and is not a tick.
It opens nothing, it closes nothing, and a dead book socket leaves the slot alone because the socket never wrote it.

The poll is [`../../server/src/feeds/anchor/AnchorPoller.ts`](../../server/src/feeds/anchor/AnchorPoller.ts), one timer per venue that fetches the venue's bulk reply and writes every tracked market with the round's start time as `ts`.
It is the REST twin of the book feed in [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts), and each venue's `anchor.ts` beside its feed maps the venue's reply into rows.
Once a second is the cadence, because on 2026-09-10 no venue changed its index or mark faster than that over 90 one second samples, and the published funding rate changed once or twice.
Bybit polls every two seconds, because its 630 KB reply took up to 850 ms to download at one hertz.
Kraken's absolute rate is divided by the mark, and its hourly settlement on the hour is derived, since the venue publishes no next funding time.

The reader at open is [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts).
It reads the three premiums on each leg and factors the cross into the three ratios of the section above, so that in fractions one plus the net edge equals one plus the index gap, times one plus the carried part, times one plus the fresh edge.
The index gap is the sell leg's index over the buy leg's after the venue price scales, and it is the structural part that funding never closes.
The carried part is the accepted premiums' gap, one plus the sell leg's mark premium over one plus the buy leg's, and it is what funding is pricing and closes over hours.
A leg without a mark counts as one there, and its whole premium shows in the fresh edge instead.
The fresh edge is one plus the sell leg's fresh premium over one plus the buy leg's, with the fees applied, and it is the net edge the two venues would show if their anchors were the same number, which is the only part a taker cross can capture.
`OpportunityManager` refuses to open a route whose fresh edge does not clear the same threshold the raw edge has to clear, and logs the refusal as a standing basis with both mark premiums and the three factors.
A route whose anchors are missing, older than ten seconds, or read more than five seconds apart is refused, and the refusal is logged with that issue, so the table holds no unjudged row.
Each reading is stamped when its poll reply arrives, so a slow reply does not read as skewed against a faster venue.
An open route closes as `fresh_edge_collapsed` once its fresh edge falls under the closure threshold, even while the raw cross still clears it.
A sample whose anchors cannot be read closes nothing.
Funding is copied onto the route and not filtered on, because the modelled trade crosses no settlement, and the premium the filter reads is what funding is already pricing.

A route whose two indices disagree is not set aside on its own.
A cross that the index gap explains already fails the fresh edge test, and a fresh edge on top of an index gap can still close, because a perp to perp trade moves no coins.
The index quarantine that set such routes aside from 2026-09-13 was removed on 2026-09-14, see [`../implemented/2026-09-14-fresh-edge-verdict-design.md`](../implemented/2026-09-14-fresh-edge-verdict-design.md).

Status: the block, the write path, the poller, the reader at open, the anchor columns on the row, the three factors, the refusal of unreadable anchors and the fresh edge close are Done.
The readings at open, peak and close are on the row as the fresh and standing edge and as the index gap and carried factors, each leg's fresh premium at open says which book sits off its anchor, and the raw anchors over the episode are the anchor series.

## Related

- [`standing-basis.md`](./standing-basis.md) is the failure these numbers explain, with the rows and the live reads.
- [`edge-at-the-touch.md`](./edge-at-the-touch.md) is the depth reading that ranks a deep basis first.

## Evidence

- The OKX SOPH recipe, the three SOPH baskets and the two ONE recipes: live probes on 2026-09-09 between 04:19 and 04:24 UTC against binance `constituents`, okx `index-components` and bybit `index-price-components`.
- The premium table: binance `premiumIndex` at 04:58 UTC on 2026-09-09, and the funding distribution from the same call without a symbol.
- The ONE same second read and wallet status: 04:21 and 04:24 UTC the same day, kucoin `currencies/ONE` and gate `wallet/currency_chains`.
- SOPH and CP premiums, predicted and realised rates, and the 08:00 regime change: sections 2a, 2b and 9 of [`../audits/2026-09-08-fourth-run-data-audit.md`](../audits/2026-09-08-fourth-run-data-audit.md).
- The skew trap: the same audit, section 9.
- Bulk endpoint counts, the bybit subscription test and the silent binance streams: probes on 2026-09-09 from 05:41 UTC over the following fifteen minutes.
- The engine block: [`../../server/src/engine/cluster/types.ts`](../../server/src/engine/cluster/types.ts) and [`../../server/src/engine/Engine.ts`](../../server/src/engine/Engine.ts).
- The work: [issue #3](https://github.com/nemanull/arbitrage-observatory/issues/3).
