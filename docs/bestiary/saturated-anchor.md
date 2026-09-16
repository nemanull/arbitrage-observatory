# Saturated anchor

A reference price that the venue clamps into a band around another number stops being a reference once the market leaves the band.
The clamp does not make the reading noisy, it makes it constant, and the constant points in the direction that opens rows.

## The row

Two rows of the fifth run, from [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md), section 9.
`net` is the raw cross after fees in ppm, `fresh` is the same cross measured against each venue's mark, `region` is the quote value of the whole profitable region at open, and `loop` is the closed loop on the row's own series.

| field | BAT 2758 | CRO 2797 |
|---|---|---|
| route | sell bybit, buy krakenfutures | sell krakenfutures, buy bybit |
| opened | 08:02:56.535 UTC | 18:37:12.386 UTC |
| duration | 6,634 ms | 14,787 ms |
| net at open, at close | 9,750 and 7,050 | 12,990 and 11,371 |
| fresh at open, at close | 7,973 and 568 | 5,610 and 877 |
| region at open | 2,711 quote units | 9,460 quote units |
| loop | +574 ppm | -499 ppm |
| `standing_basis` refusals on the route | 103 | 38 |
| close reason | `fresh_edge_collapsed` | `fresh_edge_collapsed` |

On BAT the kraken ask held one value, 0.074, for the whole 6.6 seconds.
The kraken mark read 0.07477 over the same window.
So the ask sat 1.03 percent under kraken's own mark, and 1 percent is the cap kraken publishes on its mark premium.

On CRO the kraken bid held 0.057 for 14.8 seconds while the kraken mark sat 5,789 ppm over the kraken index.
The cap is 10,000 ppm, so that mark was more than half way out to it, and the audit reads it as near the cap.
CRO also sits inside the 18:37 flash crash, where the audit measures kraken legs 2.2 to 2.9 seconds behind their own tape, so that row carries two faults at once and cannot separate them.

The gate these rows passed is one line.
`OpportunityManager.ts:139` refuses a route whose fresh edge is under `MIN_NET_PPM`, which is 5,000 at `OpportunityManager.ts:8`, and logs it as a standing basis.
The fresh edge is built from each leg's fresh premium, the touch divided by that venue's mark, at [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) line 84.

Take the BAT row apart on its own arithmetic.
The kraken leg is the buy leg and its fresh premium is 0.074 over 0.07477, which is -10,298 ppm.
Dividing by that denominator multiplies the fresh edge by 1.0104, which is 10,405 ppm of the reading.
Had the mark finished absorbing the move, so that the ask sat at it, the same row would have read about -2,407 ppm fresh and the gate would have refused it.
Every ppm of that row's fresh edge came from the clamp, and then some.

CRO is the milder version of the same sum.
Its kraken bid sat 0.24 percent over the kraken mark, worth 2,400 ppm on the sell leg, and removing it leaves 3,202 ppm against a gate of 5,000.

## The book behind the row

Both kraken markets were read live on 2026-09-16 at 01:05 UTC, in section 2c of the audit.

| market | levels bid, ask | own spread | 24 h volume | last trade age | one maker |
|---|---|---:|---:|---|---|
| PF_BATUSD | 11, 6 | 0.45% | 153,476 dollars | 4 min | no, but thin |
| PF_CROUSD | 26, 43 | 0.60% | 83,470 dollars | 141 min | yes at the touch, 15,000 a side |

These are books where a price can sit 1 percent away from the index for seconds at a time, because almost nobody is quoting them, which is the condition the clamp needs.

## The mechanism

A perpetual futures venue publishes three numbers next to each market.
The index is what the asset costs on spot venues, the book is where people are actually quoting the perp, and the mark is the venue's accounting price, which decides margin, liquidations and the notional funding is charged on.
[`index-mark-and-premium.md`](./index-mark-and-premium.md) works through all three.

The mark is not the book.
It is the index plus a smoothed copy of the premium over the last few minutes, and venues bound how far it may stray from the index, because a mark that follows a thin book off a cliff liquidates everybody.
Kraken bounds it at 1 percent.

Inside the band the mark keeps absorbing the move, so the fresh premium decays toward zero as the venue accepts the new price.
That decay is the whole test.
A real dislocation reads large and then expires, and the gate is built on the expiry.
Outside the band the mark cannot finish absorbing anything.
It stops at the edge and the fresh premium stops with it, at roughly the dislocation minus the cap, and that residue never decays however long the book stays where it is.
So a leg past the band does not read a fixed number.
It reads a floor that never clears, and a gate that waits for a fresh edge to expire will wait forever.
The audit and [`../backlog/2026-09-15-open-gate-safeguards.md`](../backlog/2026-09-15-open-gate-safeguards.md) both put it as a fixed 1 percent, which is the shape of BAT 2758 rather than the general case.

The direction is the part that matters, because a clamp is one sided by construction.
It can only pull the mark back toward the index, which means it can only leave the touch looking further from the mark than the venue believes it is.
A cheap buy leg keeps looking cheap and an expensive sell leg keeps looking expensive, and both of those are what the fresh gate is hunting for.
A symmetric error would waste half its rows on refusals nobody sees, and this one spends all of them on rows.

## What the fifth run does not prove

Neither row shows the clamp engaged, and the entry would be dishonest without saying so.

The audit publishes no kraken index for BAT 2758.
The one quantity that would show the mark sitting on its band, the mark over the index, cannot be recomputed for that row.
CRO 2797 does publish it, and at 5,789 ppm that mark was well inside a 10,000 ppm band rather than on it.
CRO also sits in the 18:37 crash, where the audit measures kraken legs 2.2 to 2.9 seconds behind their own tape.

So what the two rows establish is narrower than the headline.
A kraken leg's gap to its own mark supplied the whole of a fresh edge that the gate then trusted.
That the band caused the gap is consistent with both rows and proved by neither.

One probe settles it.
Poll kraken `tickers` once a second on a market whose book is more than 1 percent from its index, and watch whether `markPrice` over `indexPrice` stops at 0.99 or 1.01 and stays there.
The same probe answers the question for every venue in the table above, which is the reason to run it now rather than after the next audit.

## Why the engine cannot see it

The engine reads `mark` as a number and never asks how it was made.

```
  the mark moved with the book because nothing was clamped     the number is a reading
  the mark stopped moving because it hit its band             the number is the band
```

Kraken's ticker carries the mark and the index, not the rule that produced them, so the two cases arrive as the same field with a plausible value in it.
The two readings that would expose the clamp, the index and the mark premium over it, are both in hand at [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) line 83, and they are spent on the index gap and the carried factor without ever being compared to a band.

## Why it is worse than publishing no mark at all

The engine already refuses a leg whose venue publishes no mark.
[`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) lines 37 to 39 return `anchor_no_mark` when either leg's mark is zero or less, before any premium is computed.
That refusal exists because a markless leg turns the fresh gate back into the raw gate, which once opened nine rows on a resting order 1.7 percent under the coinbase index.
So the system has a correct answer for an absent reference and no answer at all for a broken one.

An absent mark is loud.
It is a zero, it hits a named refusal, and the route never opens.
A saturated mark is quiet.
It is a positive number of the right magnitude, it passes every guard the reader has, and it carries the confidence of a real measurement into a gate that was built to trust it.
An estimator sitting at its limit reports its limit, not the truth, and nothing downstream can tell the two apart.

The fifth run makes the asymmetry literal.
The run refused 3,155,976 opens, and the six reasons in the audit's table, `standing_basis`, `anchor_moving`, `thin_book`, `anchor_skewed`, `unconfirmed_cross` and `anchor_missing`, sum to exactly that total.
`anchor_no_mark` is one of the five anchor issues at `server/src/engine/opportunity/types.ts:42` and it fired zero times.
The refusal for a missing reference never triggered, while the reference that was present and meaningless wrote rows.

## The same clamp elsewhere

This is not a kraken quirk, and [`index-mark-and-premium.md`](./index-mark-and-premium.md) already documents two more clamped quantities without naming the failure.

Coinbase's mark is the median of best bid, best ask and last trade, clamped into a band of the index.
Two of the three inputs are the book, so a coinbase mark that is pinned at the band is again a book reading with the book taken out of it.

Funding is the other one.
The rate is the premium averaged over the interval, plus a small interest term, clamped to a cap, and the caps are per symbol and they change.
SOPH settled at bybit's -2 percent cap on 2026-09-08, and [`index-mark-and-premium.md`](./index-mark-and-premium.md) calls that a capped rate during a mania.
A rate at its cap is no longer telling you what the premium is, it is telling you the premium is at least the cap, and the two statements read identically in the column.

The venue survey in [`../research/2026-09-15-five-venue-integration.md`](../research/2026-09-15-five-venue-integration.md) found a cap on four of five candidate venues.
Gate bounds its mark at 3 percent on TradFi contracts.
Bitstamp bounds it at 10 percent of the oracle while the oracle is running.
MEXC publishes `priceCoefficientVariation` per contract, and one probe caught `STANDARD_USDT` reading a mark premium of 4.9956 percent against a field of 0.05, a ratio of 0.999, while its book mid sat at 5.595 percent.
No other contract in that sweep passed a ratio of 0.651.
Gemini is the worst of them, with a mark premium observed pinned at one of two edges exactly 1,000 ppm apart, against a fresh gate set at 5,000 ppm.

The general rule is short.
Wherever a system feeds a clamped quantity into a ratio, the ratio saturates silently, and the saturation is one sided.

## How to detect it

Compare the computed mark premium against the venue's published band, and treat a premium at the band as no reading rather than as a valid one.

The premium is already there, since `readLeg` computes `markPremium` as the mark over the index at line 83 of the reader.
The test is one comparison next to the markless test at lines 37 to 39, and it routes the leg into the same `anchor_no_mark` refusal, because that is exactly what a saturated mark is.

The trigger has to be at or beyond the band rather than exactly on it, because readings around a band do not land on it.
BAT's kraken leg came out 1.03 percent away from its own mark against a cap of 1 percent, and a rule written as equality would have missed the row that motivated it.

The band is not a field.
The tickers reply the poller reads, typed at `server/src/venues/krakenfutures/types.ts:33`, carries the mark and the index and no band, because the cap is a venue rule rather than a per market number, so it has to live as a constant.
[`../../server/src/venues/registry.ts`](../../server/src/venues/registry.ts) is where the other per venue constants live, as optional fields of `VenueConnectorOptions` at [`../../server/src/ccxt/types.ts`](../../server/src/ccxt/types.ts) line 18, next to `takerPpm` and `contractSize`.
A `markPremiumCapPpm` of 10,000 on the `krakenfutures` entry, left undefined where no cap is published, would follow the path `takerPpm` already takes onto every `Market` at `server/src/ccxt/connector.ts:162` and `:173`, and the reader would have it in hand.
MEXC is the one venue where that shape changes, because there the band arrives per contract in the catalog and the constant would be a field name instead of a number.

What it costs is worth saying plainly, because the rule refuses a leg exactly when it has moved furthest from the index, and that is also when a real dislocation is largest.
It trades a class of false positives for a class of missed real events, and the only honest defence of the trade is that a saturated leg carries no information either way.
Refusing a leg you cannot read is not caution, it is arithmetic.

## How common it was

Two of the 66 rows of the fifth run, BAT 2758 and CRO 2797, are the ones the audit names.
Both sit inside a larger class of six rows where a kraken leg held a single value for 0.4 to 14.8 seconds, which is [`slow-venue-resting-order.md`](./slow-venue-resting-order.md).

| pair | route | kraken leg held one value for |
|---|---|---|
| BAT 2758 | bybit-krakenfutures | 6.6 s |
| MNT 2778 | bybit-krakenfutures | 0.44 s |
| SSV 2793 | krakenfutures-bybit | 2.9 s |
| CVX 2794 | krakenfutures-binance | 2.8 s |
| VELO 2796 | krakenfutures-bybit | 10.2 s |
| CRO 2797 | krakenfutures-bybit | 14.8 s |

The run put 132 venue legs on rows and only 12 of them were kraken, of which 6 held one value.
Two rows out of 66 is small, and the rate is not the interesting number, because the condition needs a book more than 1 percent from its index.
On a venue like kraken that means a thin market or a crash, and both rows are exactly that.
It will grow with the venue list rather than with volume, because the survey above found a cap on four of the next five venues and one of them is pinned to its band in normal conditions.

## Related

- [`index-mark-and-premium.md`](./index-mark-and-premium.md) defines the index, the mark and the three premiums, and documents the coinbase and funding clamps.
- [`slow-venue-resting-order.md`](./slow-venue-resting-order.md) is the class both rows belong to, and it is about the book rather than the reference.
- [`standing-basis.md`](./standing-basis.md) is what the fresh gate exists to refuse, and a saturated anchor is how a standing basis gets past it.
- [`stale-quote.md`](./stale-quote.md) is the other way a number the engine holds is not a reading of anything.

## Evidence

- The two rows and their kraken marks: section 2c of [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md), with the full lines in section 9.
- The live kraken books: the 01:05 UTC probe of 2026-09-16 listed in section 8 of the same document.
- The refusal counts and the gates in force: section 0 of the same document.
- The markless refusal and the premiums: [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) lines 37 to 39, 83 and 84.
- The fresh gate: `server/src/engine/opportunity/OpportunityManager.ts:139` with `MIN_NET_PPM` at line 8.
- The proposed repair and its size: section 3 of [`../backlog/2026-09-15-open-gate-safeguards.md`](../backlog/2026-09-15-open-gate-safeguards.md).
- The caps on other venues: [`../research/2026-09-15-five-venue-integration.md`](../research/2026-09-15-five-venue-integration.md) section 5, and section 4 of [`../profiles/mexc/rest.md`](../profiles/mexc/rest.md).
