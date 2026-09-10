# Settlement dip

A perp that moves against the side paying funding in the minutes around its settlement instant, because that side is leaving before the bill and coming back after.
Both books are real, the move is real, and it closes on its own within minutes.
It is a cross-venue gap with a timetable, and the bill is already attached to it.

The vocabulary is in [`index-mark-and-premium.md`](./index-mark-and-premium.md), and the instant itself is defined in its Funding section.

## The capture

No run of the engine has recorded this class yet, because no row carried a settlement time to read it against.
The evidence is a live capture across the 19:00 UTC settlement on 2026-09-10, on the hourly symbols with the largest rates on bybit and binance, sampled every two seconds from twelve minutes before to six minutes after.

IOST on bybit settled hourly at a displayed rate of -0.19 percent, shorts paying longs, against a round trip taker fee of 0.11 percent.

| seconds from the instant | mid over index, bp | mark over index, bp |
|---:|---:|---:|
| -180 | -45 to -35 | -35 to -39 |
| -120 | -33 to -18 | -33 to -18 |
| -60 | -27 to -20 | -23 to -25 |
| -30 | -40 to -23 | -25 to -27 |
| 0 | -62 to +2 | -23 to -29 |
| +30 | -61 to -43 | -29 to -34 |
| +60 | -57 to -10 | -34 to -21 |
| +90 | -28 to -9 | -20 to -24 |
| +300 | -40 to -19 | -27 to -26 |

Three minutes before the instant the perp sat 45 basis points under its index.
It climbed to 20 under in the last minute, touched 2 over in the instant's own sample, and thirty seconds later it sat 62 under.
Ninety seconds after that it was back where it had started.
The mark barely moved through all of it, because it is an average over minutes.

IOST on binance, hourly at -0.15 percent, drew the same shape 1.5 percent lower, because binance holds its IOST perp far under its index and bybit does not.

| seconds from the instant | mid over index, bp |
|---:|---:|
| -180 | -162 to -154 |
| -30 | -172 to -154 |
| 0 | -197 to -130 |
| +30 | -189 to -168 |
| +90 | -163 to -149 |

B3 on bybit at -0.048 percent, ONG on binance at -0.038 percent and SOPH on binance at -0.020 percent settled at the same instant and drew nothing.
Their rates sit under the fee it costs to leave and come back.

## The second capture

The four hour symbols settled at 20:00 UTC the same evening, and the largest rate on either venue was VTHO on binance, -0.56 percent per settlement, shorts paying, five times the round trip fee.

| seconds from the instant | mid over index, bp |
|---:|---:|
| -240 | -133 to -101 |
| -180 | -105 to -84 |
| -60 | -121 to -54 |
| -30 | -109 to -92 |
| 0 | -142 to -92 |
| +60 | -142 to -94 |
| +180 | -152 to -122 |
| +300 | -155 to -80 |

Both halves of the dance, and the second half did not recover inside the window.
The perp climbed 30 basis points toward its index in the four minutes before the instant, touched 54 under in the last minute, and then sat 30 to 40 under its starting level for the five minutes after.

Two commodity perps on binance drew only the second half.
Brent, paying -0.33 percent with shorts paying, and natural gas, paying 0.31 percent with longs paying, both three times the fee.

| seconds from the instant | Brent, mid over index, bp | natural gas, mid over index, bp |
|---:|---:|---:|
| -240 to -30 | -72 to -64, flat | +67 to +74, flat |
| 0 | -108 to -85 | +71 to +86 |
| +60 | -108 to -102 | +88 to +95 |
| +120 | -107 to -105 | +101 to +104 |
| +300 | -109 to -105 | +101 to +106 |

Nothing moved before the instant.
At the instant each perp stepped 35 basis points in the direction of its paying side coming in, down where shorts pay and up where longs pay, and stayed there.
The paying side had not left early, it had waited, and it came in the moment the bill was behind it.
Bybit IOST drew its hourly shape again at 20:00, a smaller climb before and a drop to 70 under in the instant's sample.

## The mechanism

Funding is charged once, at the instant, to every position open at that moment.
Nothing is charged between two instants.
So a position that is closed one second before the instant and reopened one second after pays no funding at all.

Everyone knows this, and the paying side acts on it when the rate is worth acting on.
With shorts paying, shorts buy back before the instant, and buying pushes the perp up toward its index.
After the instant they sell to reopen, and selling pushes it back down.
With longs paying, the same dance runs the other way.
Whether the payers leave early or only wait to come in, their side is thinnest at the instant and rebuilds right after it, and that rebuild is the step every capture shows.

It does not break the mechanism, because the exploit is self defeating.

1. To leave, a payer needs a counterparty, and the only counterparty is someone willing to hold through the instant and pay the bill.
   That someone wants a discount worth the bill.
2. So the payers move the price against themselves until the discount is about the rate minus the fees.
   Any less and more payers leave, any more and staying is cheaper.
3. Whoever is still open at the instant pays the rate.
   The dodgers pay nothing on the funding ledger.
4. The dodgers come back after the instant and buy or sell the recovery, from the people who took the other side of their exit.

Ten thousand USDT of notional, a one percent rate, 500 ppm taker fees.

| choice | funding | price given up | fees | total |
|---|---:|---:|---:|---:|
| hold through the instant | 100 | 0 | 0 | 100 |
| leave before, come back after | 0 | about 90 | 10 | about 100 |

Same money, to the same people, through the order book instead of the funding ledger.
The dodge pushes the perp onto its index, which is what funding exists to do, and every dodge is two trades, which is what the venue charges for.
That is why binance, bybit and okx keep the single instant.
Kraken accrues funding through the hour instead and books it on the hour, so on kraken there is nothing to dodge.

The threshold is the fee.
On IOST the rate was three times the round trip and the shape appeared on both venues.
On B3, ONG and SOPH the rate was a fraction of it and nobody moved.
Across all 900 binance perps on 2026-09-09 the median rate was 0.005 percent and the 99th percentile 0.14 percent, so the shape belongs to the one percent of symbols where funding is capped or close to it.

## What the engine reads

Two venues rarely settle the same coin on the same clock.
SOPH after 2026-09-08 08:00 settled hourly on bybit and binance and every four hours on okx.
At every bybit instant the bybit perp dips against a perp on okx that has no reason to move, and a cross opens for a minute or two with a known cause and a known end.
Even on the same clock the instant itself is a flicker: bybit IOST touched 2 basis points over its index in the same two seconds that binance IOST touched 197 under.

The fresh edge test in [`../../server/src/engine/anchorReading.ts`](../../server/src/engine/anchorReading.ts) reads the dip as fresh, and it is fresh, in that it closes on its own.
The mark lags the dip by construction, so nothing in the anchors says the move was timetabled.
What the test cannot see is that the dip is a price for the coming bill.
Buying the dip on the settling venue and holding through the instant earns the dip and pays the rate it was compensating for, and the two net to about the fees.
The capturable part is only what sits beyond that, and it is competed for by everyone with a clock.

## How to detect it

Read the clock, not the book.

1. Carry each leg's next settlement time and interval on the route at open, which the anchor block already holds as `nextFundingAt` and `fundingIntervalHours`.
2. Tag a route that opens within a few minutes of either leg's instant, and note which leg is settling and in which direction its rate points.
   On the sell leg with shorts paying, the dip is the leg coming back down after the instant.
3. Compare the rate with the round trip fee.
   Under the fee there is no dodge and the tag means nothing, over it the shape should be there.
4. Read the displayed rate with care in the minutes after an instant.
   Bybit resets the displayed rate to the bare interest term for the new interval, 0.00125 percent on an hourly symbol and 0.005 percent on a four hour one, a few seconds after the hour, then shows the first minute's premium on its own, which read -0.32 percent on IOST and -0.61 percent on RVN, before it settles down over the following minutes.
   Binance keeps the settled value on display and drifts from there.
   Both venues refresh the displayed value about once a minute, and on binance the last value before the instant was the settled value to the digit on all five symbols at 20:00, while bybit's differed from the settled one by up to 1.8 percent of itself.
5. Take the instant's timing from the venue.
   Binance's history stamps the settlements at 19:00:00.004 and between 20:00:00.000 and 20:00:00.002, and its next settlement time rolled within two to four seconds.
   Bybit's rolled between four and ten seconds after the hour.

What the displayed rate was worth just before the instant, against what was charged.

| venue, symbol | last displayed at 18:59:58 | realised at 19:00 |
|---|---:|---:|
| bybit IOST | -0.1922 % | -0.1909 % |
| bybit B3 | -0.0479 % | -0.0624 % |
| binance IOST | -0.1512 % | -0.1532 % |
| binance ONG | -0.0382 % | -0.0380 % |
| binance SOPH | -0.0204 % | -0.0204 % |

The open questions about the instant itself, which clock, who counts as open, and how an interval change is announced, are [issue #17](https://github.com/nemanull/arbitrage-observatory/issues/17).

## Related

- [`index-mark-and-premium.md`](./index-mark-and-premium.md) defines the four numbers and the instant.
- [`standing-basis.md`](./standing-basis.md) is the gap that never closes, where this one closes on a timetable.
- [`flicker.md`](./flicker.md) is the shape the instant's own sample takes.

## Evidence

- The first capture: [`../../scripts/probes/settlement-instant-probe.mjs`](../../scripts/probes/settlement-instant-probe.mjs) run at 18:57 UTC on 2026-09-10 against the 19:00 instant, 259 rounds of two seconds on bybit IOST and B3 and binance IOST, ONG and SOPH, summarised by [`../../scripts/probes/settlement-instant-analyse.mjs`](../../scripts/probes/settlement-instant-analyse.mjs).
- The second capture: the same probe from 19:48 UTC against the 20:00 instant, 539 rounds on bybit RVN, IOST, KAT, B2, 4STOCK and SOPH and binance VTHO, BZ, NATGAS, CL and RVN.
- The realised rates: bybit `funding/history` and binance `fundingRate`, read at 19:06 and 20:06 UTC the same day.
- The rate distribution: binance `premiumIndex` without a symbol at 04:58 UTC on 2026-09-09.
- The SOPH regime change: section 2a of [`../audits/2026-09-08-fourth-run-data-audit.md`](../audits/2026-09-08-fourth-run-data-audit.md).
