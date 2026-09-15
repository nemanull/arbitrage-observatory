# ONE through the fresh gate on binance momentum

Date: 2026-09-15, rows 2739 and 2743 of the seventh run, with live probes at 06:19 to 06:22 UTC.
Question: ONE left `DENIED_PAIRS` on 2026-09-15 after [`./2026-09-15-denied-basis-pairs-gate-probe.md`](./2026-09-15-denied-basis-pairs-gate-probe.md) saw every ONE route refused, so how did row 2739, a 3.7 percent binance-okx cross, open at 02:52:42 UTC and ride to the age cap.
Vocabulary: [`../bestiary/index-mark-and-premium.md`](../bestiary/index-mark-and-premium.md) and [`../bestiary/standing-basis.md`](../bestiary/standing-basis.md).

## 0. Method

The row is read from the `ArbitrageOpportunity` table on port 5532.
The refusals of the route are the `opportunity_rejected` lines in the SigNoz logs, which the engine writes once per ten seconds per route and reason with an `occurrenceCount`.
The venue history is binance's 1 minute mark, index and perp klines for 02:40 to 03:00 UTC.
The basket read is binance `/fapi/v1/constituents` for every `TRADING` USD-M perpetual, 564 of 571 answered, and okx `/api/v5/market/index-components` for `ONE-USDT`.

## 1. The row

Row 2739 sells on binance `ONEUSDT` and buys on okx `ONE-USDT-SWAP`.
It opened at 02:52:42.021, closed at 02:57:42.715 as `age_cap`, and took 272 samples.

| reading at open | binance, sell leg | okx, buy leg |
|---|---:|---:|
| touch, raw | bid 0.0007108 | ask 0.0006845 |
| index | 0.0007112 | 0.0006781 |
| mark | 0.00070598 | 0.0006842 |
| mark over index | -0.734 % | +0.900 % |
| touch over mark, the fresh premium | +0.683 % | +0.044 % |

| factor | ppm |
|---|---:|
| net after fees | 37,384 |
| index gap, binance index over okx index | 48,813 |
| carried, the two mark premiums | -16,190 |
| fresh, the two fresh premiums after fees | 5,380 |
| standing, net minus fresh | 32,004 |

The arithmetic of [`anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) reproduces every stored number from these inputs.
The gate saw 5,380 against `MIN_NET_PPM` of 5,000 and let the route through by 380 ppm.
The whole fresh edge sits on the binance leg, whose bid stood 0.683 percent above the binance mark.

## 2. The binance anchor is the perp itself

At 06:19 UTC the binance basket for `ONEUSDT` held one constituent, `binance_future ONEUSDT` at weight 1.0, the same read as on 2026-09-09 in [`../bestiary/index-mark-and-premium.md`](../bestiary/index-mark-and-premium.md).
A sweep of every `TRADING` USD-M perpetual found it to be the only basket made of nothing but the perp.
88 other baskets hold the perp beside spot venues, at 5 to 40 percent, with 1000000BOB, 4, AIO, ARC, BULLA, COLLECT, DRIFT, ESPORTS, GUA, MYX, NAORIS, PLAY, SIREN, SKYAI and TRUTH at 30 percent or more.
Seven symbols did not answer: BTCDOMUSDT, ALLUSDT and five with non-ASCII names.

The okx basket for `ONE-USDT` is five spot markets, binance spot 28.6 percent, okx 28.6 percent, kucoin, gate and mexc 14.3 percent each.
Binance spot printed 0.000717 in it while kucoin, gate and mexc printed 0.000669 to 0.000670, which is the closed-wallet split behind the 4.9 percent index gap.

So on this route one leg's index carries no information from outside the perp being judged, and the mark that binance builds from that index is a trailing average of the same perp.

## 3. The mark trails the perp by about five minutes

Binance 1 minute klines, close of each minute, UTC.

| minute | perp | index | mark |
|---|---:|---:|---:|
| 02:48 | 0.0007041 | 0.0007041 | 0.00070589 |
| 02:49 | 0.0007062 | 0.0007062 | 0.00070550 |
| 02:50 | 0.0007064 | 0.0007064 | 0.00070549 |
| 02:51 | 0.0007089 | 0.0007089 | 0.00070563 |
| 02:52 | 0.0007109 | 0.0007109 | 0.00070607 |
| 02:54 | 0.0007134 | 0.0007134 | 0.00070744 |
| 02:57 | 0.0007136 | 0.0007136 | 0.00071112 |
| 02:59 | 0.0007131 | 0.0007131 | 0.00071354 |

The index equals the perp to the tick.
Between 02:48 and 02:52 the perp rose 0.97 percent and the mark rose 0.03 percent.
The mark reached at 02:57 the level the perp had at 02:52.
So the binance fresh premium on ONE is the perp's own rise over the last few minutes, and it clears 0.6 percent whenever the perp has risen about that much since the start of the mark's window.
The anchor moving guard cannot see it, because a mark that climbs 0.7 percent over five minutes moves about 25 ppm per poll against `MAX_ANCHOR_MOVE_PPM` of 1,000.

## 4. The refusal trace before the open

Over the run the engine refused binance-okx ONE as `standing_basis` 12,880 times with a median fresh of -1,808 ppm and a maximum of 4,758, and as `anchor_moving` 1,512 times.
The logged lines for the thirteen minutes before the open show the same mechanism running both ways.

| time UTC | fresh ppm | binance bid over mark | binance mark over index | binance index |
|---|---:|---:|---:|---:|
| 02:40:14 | -1,868 | -0.028 % | -0.014 % | 0.0007088 |
| 02:41:34 | -4,990 | -0.326 % | +0.285 % | 0.0007063 |
| 02:48:43 | -4,597 | -0.316 % | +0.360 % | 0.0007034 |
| 02:49:51 | -2,770 | -0.104 % | +0.075 % | 0.0007050 |
| 02:50:17 | 281 | +0.113 % | -0.113 % | 0.0007063 |
| 02:51:54 | 560 | +0.303 % | -0.302 % | 0.0007077 |
| 02:52:04 | 3,440 | +0.459 % | -0.471 % | 0.0007090 |
| 02:52:19 | 3,966 | +0.541 % | -0.594 % | 0.0007100 |
| 02:52:32 | 4,758 | +0.621 % | -0.533 % | 0.0007096 |
| 02:52:42, open | 5,380 | +0.683 % | -0.734 % | 0.0007112 |

On the falling tape from 02:40 to 02:49 the mark sat above the price and fresh read -1,700 to -4,990.
On the rising tape from 02:50 the mark sat below the price and fresh climbed through the gate in under three minutes.
The okx leg stayed within 0.15 percent of its own mark on every line.

## 5. Why it ran to the age cap

The fresh series decayed as the mark caught up, but the perp kept rising to 0.0007160 at 02:58, so the mark never caught it inside the window.
Fresh sat above 5,000 for most of the first two minutes, above 3,800 for the first three, and its lowest readable sample was 1,050 at 260 s, with 1,556 at close.
`CLOSURE_NET_PPM` is 1,000 in [`OpportunityLifecycle.ts`](../../server/src/engine/opportunity/OpportunityLifecycle.ts), so `fresh_edge_collapsed` never fired.
The raw cross never converged, with a minimum of 35,780 ppm and 37,256 at close.
A taker who sold binance and bought okx at open and unwound at close would have paid about 1,000 ppm of fees plus two spreads for 128 ppm of cross movement.

Row 2743 at 03:38:18 is the same shape on the same route, bid over mark 0.559 percent, fresh 5,167 at open, closed by `fresh_edge_collapsed` after 100 s at 776 ppm.

## 6. What the gate probe measured

The 2026-09-15 gate probe ran from 00:47 to 00:50 UTC on a tape where the binance ONE bid sat 0.087 percent over its mark, and fresh read -567 ppm at the median.
That holds only while the binance perp is flat.
The probe's limits named a fresh spike as a way in, and on this route the spike needs no other venue, because the anchor pair has one leg whose index and mark are functions of the perp being judged.

## 7. Options

1. Refuse a leg whose index basket is only the venue's own perp, the way `anchor_no_mark` refuses a leg without a mark.
   [`binance/anchor.ts`](../../server/src/venues/binance/anchor.ts) already rereads the funding interval table every hour, and the constituents call can ride that cycle, 564 requests at four in flight in under two minutes.
   Today the rule names one symbol, and it names the next one binance switches to itself without a hand edit.
2. Put ONE back on `DENIED_PAIRS` by hand.
   One line, but it names the pair rather than the mechanism, which [`../bestiary/standing-basis.md`](../bestiary/standing-basis.md) records as the pattern that never shrank the class.
3. A fresh hysteresis or age above the gate, the lever from the CVC and POWR rows of the same run.
   It would not have stopped this row, because fresh stayed above the gate for about two minutes.

The baskets that hold the perp at 5 to 40 percent beside spot venues soften the anchor rather than remove it, and are not judged here.

Decision on 2026-09-15: option 2.
The defect names one market on one venue, nothing trades on a missed one, and an audit catches the next one the way it caught this one.
The basket sweep stays a hand-run check until the list needs a second edit, and the boot-time check was set aside as more machinery than one line of data warrants.

## Limits

- Klines are 1 minute closes, so the mark's window is inferred from its lag, not read from a published formula.
- The basket sweep is one read at 06:19 UTC, and baskets change when listings change.
- The refusal lines are one per ten seconds per route and reason, so the trace shows the shape of the climb, not every poll.
