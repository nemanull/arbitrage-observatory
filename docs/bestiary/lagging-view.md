# Lagging view

The engine's picture of a venue runs seconds behind that venue's own tape while the socket keeps delivering frames at full rate.
Nothing is frozen and nothing is silent, so every price on the row is real and every price is old, and the cross is measured between two different instants.

## The row

Row 2787 of the fifth run, from [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md).

| field | value |
|---|---|
| pair | `ETH` |
| route | krakenfutures-binance |
| opened | 18:37:11.669 UTC |
| duration | 2,307 ms |
| net ppm at open | 10,807, which is 1.08% |
| net ppm at close | 3,395 |
| fresh net ppm at open | 8,373 |
| region at open | 134,355 quote units |
| close reason | `fresh_edge_collapsed` |

A route is written as the bid venue and then the ask venue, so this row sells a kraken bid, buys a binance ask, and claims the largest region of the run on the deepest pair on the board.
Here is the row against what each venue's own trade tape says for the same milliseconds.

| leg | what the row showed | what the venue's tape said |
|---|---|---|
| kraken bid | 2406.6 at 18:37:11.669, walking down to 2386.0 by 18:37:13.976 | last print at or above 2405 at 18:37:09.458, prints of 2376.0 to 2383.4 during 18:37:11, 2367.8 at 18:37:12.000 |
| binance ask | 2378.49 from 18:37:11.669 to 12.545 | 826 taker buys down to 2374.91 in that window, then 657 down to 2371.51 while the row held 2378.37 |

Both legs are behind, by different amounts.
The kraken bid the engine was selling had last traded about 2.2 seconds earlier, and the binance ask it was buying had 826 taker buys underneath it that had not arrived yet.
The 1.08% is the distance between 18:37:09 on kraken and 18:37:11 on binance.

The socket was not quiet during any of this.
The kraken leg fell 0.86% in 96 separate steps over those 2.3 seconds, so at least 96 frames arrived and every one of them was late.

## The mechanism

At 18:37 the whole market dropped and recovered inside one minute.
Binance ETHUSDT printed open 2419.41, low 2371.50 and close 2410.01 on 186,731 ETH of volume, against 5,452 to 16,743 ETH in each of the four minutes before.
Kraken PF_ETHUSD printed a low of 2360.5, under binance's low, and closed at 2410.0.
The ETH one minute lows were 1.98% under the open on binance, 2.25 on okx, 2.02 on bybit and 2.43 on kraken, and RAVE fell 5.7%, STX 4.3 to 5.2, OP 2.8 to 3.1, KAITO 2.0 to 2.2 and AERO 1.6 to 2.0.
A second leg followed at 18:45, when BTC fell from 75,745 to 75,312, MARSCOIN 3.7% and C 3.4%, and IOST kept falling to a 2.8% low at 18:49.

The venues did not disagree with each other, because every venue printed each drop in the same second, and okx crashed RAVE, OP, KAITO and AERO in the same second as binance did.
What disagreed was the engine's view of one socket against its view of another.
Fitting each leg's recorded series to the venue's last print with a time shift gives the lag per socket.

| socket | lag behind its own tape |
|---|---|
| okx | 1.1 to 3.7 s, KAITO 3.1, AERO 3.7, RAVE 1.7 to 1.8, OP 1.2 |
| krakenfutures | 2.2 to 2.9 s |
| binance, on the ETH, OP and STX rows | about 1 s |
| binance, on the KAITO, RAVE, MARSCOIN and C rows | 0.1 to 0.7 s |

So each row is the lagging leg's pre crash price against the current leg's post crash price.
More lag on one side produces a bigger number, which is the opposite of what a profit signal should do.
Three more rows show the same shape.

| row | leg | what the row showed | what the venue's tape said |
|---|---|---|---|
| 2784 KAITO okx-binance | okx bid | 0.2912 from 18:37:10.144 to 12.370 | last print at or above 0.2912 at 18:37:09.182, 655 prints of 0.2858 to 0.2880 during 18:37:10 |
| 2782 OP okx-binance | okx bid | 0.09778 at 18:37:10.502 | prints at or above 0.09778 only from 18:37:08.070 to 09.432, 0.09628 to 0.097 during 18:37:10 |
| 2779 and 2780 RAVE okx | okx bid | 0.1797 from 18:37:01.649 to 02.257 | last print at or above 0.1797 at 18:37:00.528, 1,874 prints of 0.1743 to 0.1793 during 18:37:01 |

One cross in the whole burst did exist on the venues' own clocks.
At 18:37:09.43 a four hour old kraken bid for 20,180 STX, worth 5,093 dollars and placed at 14:35:30, was consumed by 14 taker sells between 18:37:09.428 and 09.450 while binance printed at or under the row's buy price, and it lasted about 25 ms.
Row 2788 opened 413 ms after that bid was gone, then held it on screen for 2.5 more seconds.

## The process was not stalled

The first suspicion is a blocked event loop, and it was not that.
Between 18:37:10 and 18:37:16 eight to twelve rows were open at once, no gap of 150 ms passed without a sample from one of them, and the longest silence was 157 ms at 18:37:16.410.
A blocked loop would have delayed every socket by the same amount, and instead okx was 1.1 to 3.7 s late and kraken 2.2 to 2.9 s late in the same seconds.
That is a per socket backlog between the venue's matching engine and the handler for that connection.

## The signature is a one frame collapse

This is the part that needs no venue data to see.
A backlogged feed does not degrade gracefully.
It holds one price while the venue moves, then delivers the whole accumulated move in a single frame.
On the row it reads as a long flat cross ended by one enormous step.

| row | pair | route | the lagging leg | net at open | net at close |
|---|---|---|---|---:|---:|
| 2779 | RAVE | okx-binance | okx bid stepped down 4 times, then fell 2.06% in one frame at 1,172 ms to 0.1754, below the binance ask | 13,667 | -10,589 |
| 2780 | RAVE | okx-bybit | the same okx bid, the same one frame collapse at 1,287 ms | 11,902 | -10,638 |
| 2810 | POWR | binance-bybit | binance bid 0.0604 one value for 318 ms, then swept 1.36% in one frame to 0.05958, below the bybit ask | 9,987 | -5,390 |
| 2813 | IOST | binance-okx | binance bid fell 1.44% at 1,394 ms | 15,250 | -1,136 |
| 2809 | HEMI | binance-bybit | binance bid drifted 0.15% in 10 steps, then fell 0.55% in one frame at 1,359 ms | 5,590 | -3,151 |

Read the last column.
A cross that converges honestly decays toward zero as the two prices meet, and a cross that was a clock difference does not decay at all.
It jumps past zero into a deep negative, because the frame that finally lands carries the move the engine had already missed.
On 2779 and 2810 the leg lands below the price on the other venue, which is not a convergence at all.

## Not a stale quote, and not a flicker

All three end with a price that was not there, for three different reasons.

| class | the socket | the price | the tell |
|---|---|---|---|
| [`stale-quote.md`](./stale-quote.md) | silent, because the channel only fires on trades | one old print held indefinitely | a leg with zero updates for the whole row |
| [`flicker.md`](./flicker.md) | current | real for a few milliseconds | both samples in the same millisecond |
| this entry | delivering at full rate | real, and old by a roughly constant offset | many updates, all shifted in time |

A stale quote is quiet and a lagging view is loud.
Row 2787 recorded 96 kraken steps inside 2.3 seconds, so every freshness test built on counting messages passes it.
A flicker is a cross that dies inside a millisecond, and the minimum cross age of 100 ms removed most of that class in this run.
A lagging view survives that test by construction, which is the next section.

## The minimum cross age selects for the worst book

`MIN_CROSS_AGE_MS` is 100 at line 14 of [`../../server/src/engine/opportunity/OpportunityManager.ts`](../../server/src/engine/opportunity/OpportunityManager.ts), and line 243 refuses a cross younger than that.
It works, and it removed the flicker class, which was 21 of 39 rows in the previous run and is 2 of 66 here.

It also has a perverse edge, because the test asks whether the same cross was still on screen 100 ms later, and it asks that of the engine's own clock.
A leg that is receiving updates on time will move within 100 ms and break the cross.
A leg that is 2 seconds behind is guaranteed to still show the same number 100 ms later, because the frame that would change it has not arrived.
So a dwell test is passed most easily by the most broken book, and every one of the 30 rows in this class cleared it.

## Why the engine cannot see it

Every active venue ships an exchange timestamp on every book frame, and every one of them is parsed into the frame type and then never read.

| venue | field | what the venue calls it | where |
|---|---|---|---|
| binance | `E`, `T` | event time, matching engine time | [`../../server/src/venues/binance/types.ts`](../../server/src/venues/binance/types.ts) lines 5 and 6 |
| bybit | `ts`, `cts` | publish time, matching engine time | [`../../server/src/venues/bybit/types.ts`](../../server/src/venues/bybit/types.ts) lines 14 and 15 |
| okx | `ts` | venue send time | [`../../server/src/venues/okx/types.ts`](../../server/src/venues/okx/types.ts) line 12 |
| krakenfutures | `timestamp` | milliseconds, on the snapshot and on every delta | [`../../server/src/venues/krakenfutures/types.ts`](../../server/src/venues/krakenfutures/types.ts) lines 7 and 20 |
| coinbase | `timestamp`, `event_time` | RFC 3339 frame and level times | [`../../server/src/venues/coinbase/types.ts`](../../server/src/venues/coinbase/types.ts) lines 23 and 4 |

The coinbase type says so in a trailing comment of its own: "unused because recvTs is the local clock".

The local clock is the only clock a book ever gets.
`publish` in [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts) defaults its `now` to `Date.now()` at line 283, and `resetBook` does the same at line 267.
No venue adapter overrides `publish` and none passes a `now` of its own, so the stamp is always the moment the handler ran.

That stamp becomes `cluster.recvTs`, declared at line 61 of [`../../server/src/engine/cluster/types.ts`](../../server/src/engine/cluster/types.ts), and every line that reads it compares it to zero.
[`../../server/src/engine/Engine.ts`](../../server/src/engine/Engine.ts) line 190 asks whether the slot is live, and lines 469 and 471 ask whether the value is finite and above zero.
[`../../server/src/engine/opportunity/OpportunityLifecycle.ts`](../../server/src/engine/opportunity/OpportunityLifecycle.ts) line 311 closes a row as `feed_down` when either leg is at zero.
[`../../server/src/engine/opportunity/OpportunityManager.ts`](../../server/src/engine/opportunity/OpportunityManager.ts) lines 321 and 345 skip a slot at zero while picking the best bid and the best ask.

Zero means the venue never spoke or its socket is down, and every other value is treated as equally current.
No line computes `now` minus `recvTs`, and no line compares one leg's `recvTs` against the other's.

The gates were no help, because `anchor_moving` wrote 232 refusal lines in the 18:37 minute and a refusal only blocks an open.
On a row already admitted it produces a blind sample, and a blind sample closes nothing, which is how AERO 2795 ran 5 seconds at 4,000 to 5,000 raw with 164 of its 165 samples blind.

## The reconnect storm is the same root cause

Under the same load the binance sockets started dying.
`binance#linear#0` reconnected 146 times and `binance#linear#1` 47 times between 18:37:15.302 and 18:56:46.739, a median of 2.8 s apart, while connections 2 and 3 never reconnected.
The client's own idle kill fired once all day, on bybit at 11:15:38, and never on binance, so a server side close of a slow consumer is the likely cause.
It cannot be proven from this export, because the reconnect line carries no close code.

Two rows opened on a socket that was about to die or had just come back.

- 1000LUNC 2792 opened at 18:37:15.218 with one sample, 84 ms before `binance#linear#0` closed, and died with it.
- ESPORTS 2798 opened 802 ms after `binance#linear#1` was reseeded, held one binance bid at its mark for 206 ms while the bybit ask sat 2.69% under the bybit mark, and died when that socket closed again.

A book reseeded from a snapshot one second ago is the least trustworthy book on the venue, and the engine treats it as the most current one.

## How to detect it

1. Each leg's exchange event time against local receipt.
   Every venue already sends one and the parse already has the field.
   Refuse a route whose legs' exchange times differ by more than about 250 ms, and refuse a leg that trails `now` by more than that.
   The caveat is that this subtracts two machines' clocks, so it needs a per venue offset.
   [`../research/2026-09-15-binance-realtime-depth.md`](../research/2026-09-15-binance-realtime-depth.md) measured all four venues agreeing with the development machine inside 5 ms, with frame arrival 53 to 69 ms after its exchange timestamp on binance, 89 to 91 on bybit and 53 on okx.
   That offset belongs to the machine it was measured on, so it has to be measured again on the host that runs the engine.
2. The skew between the two legs' observation times.
   This one needs no absolute agreement with anyone, only an offset per venue that is stable.
   A cross whose two legs were observed 2 seconds apart is not a cross.
3. The one frame collapse.
   It costs nothing and it labels the class on rows that are already written.
   A row whose last sample moves one leg further than the whole cross, in one step, after a flat stretch, was a clock difference and not a trade.
4. A quarantine after a reconnect.
   Treat a market whose socket closed inside the last few seconds as unhealthy until its second snapshot, and log the close code on the reconnect line so the cause stops being a guess.

## How common it was

30 of the 66 rows of the fifth run, the largest single class, all of them inside the two crash windows.

| window | rows |
|---|---:|
| 18:37:01 to 18:37:53 | 17 |
| 18:45:42 to 18:49:25 | 13 |

The pairs are RAVE 2, SPX, OP 3, KAT, KAITO, LAB, ETH, STX, MUBARAK, INIT, AERO, SQD, ASTER 2, FOGO, SAND, LINEA, C, MARSCOIN, HEMI, POWR, TRIA, 1000LUNC, ESPORTS and IOST 3.
Five of them are the binance socket itself: 1000LUNC 2792, ESPORTS 2798 and the three IOST rows 2811, 2812 and 2813.
Four more rows of the same burst are classed as slow venue resting orders because they carry a kraken leg, SSV 2793, CVX 2794, VELO 2796 and CRO 2797, and the row alone cannot say which of the two facts it is showing.

Every edge column on all 30 rows measures the distance between two clocks rather than a price difference, which is why `edgeNotionalAtOpen` of 134,355 on ETH 2787 is the size of a region that never existed.

## Related

- [`stale-quote.md`](./stale-quote.md) is the quiet version, where the channel says nothing at all.
- [`flicker.md`](./flicker.md) is the fast version, a real cross that dies inside a millisecond.
- [`slow-venue-resting-order.md`](./slow-venue-resting-order.md) is the honest version, a price that is old because nobody has taken it.
- [`standing-basis.md`](./standing-basis.md) is the other large class of this run, where both views are current and the two venues genuinely disagree.

## Evidence

- The class, the crash, the lag fits, the STX cross and the reconnect counts: section 2a of [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md).
- Every row quoted here, with its net at open and at close: section 9 of the same document.
- The misreading of the edge columns: section 4, item 1 of the same document.
- The proposed repairs: section 5, items 1 and 4 of the same document.
- Clock agreement and frame arrival delay: section 1 of [`../research/2026-09-15-binance-realtime-depth.md`](../research/2026-09-15-binance-realtime-depth.md).
- The local stamp: [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts) lines 267 and 283.
- The unread exchange timestamps: the five `types.ts` files under [`../../server/src/venues/`](../../server/src/venues/).
