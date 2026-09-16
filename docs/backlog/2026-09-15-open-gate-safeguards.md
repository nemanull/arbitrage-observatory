# Safeguards the open gate does not have

Status: Not started.
Recorded: 2026-09-15.
Indexed in [BACKLOG.md](../BACKLOG.md).

## Finding

The fifth run wrote 66 rows and refused 3,155,976 opens, and not one row was capturable.
The evidence is in [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md).

[`2026-09-08-judgment-inputs.md`](./2026-09-08-judgment-inputs.md) asked which inputs the judgment does not read.
This entry asks the narrower question the fifth run raised.
Given the inputs the engine already holds in memory, which check was never written.

Three missing checks account for 58 of the 66 rows.
They share one shape.
Every gate on the open path judges what a quote says, and no gate judges when that quote was true or where it came from.
The engine holds five numbers per venue per pair, the bid, the ask, their sizes and a receive time, and it spends the first four on the decision and the fifth on nothing but a liveness flag.

A second shape runs underneath the first.
The anchors were given a full set of provenance guards and the books were given none.
[`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) refuses an anchor that is missing, one whose two legs were read more than `ANCHOR_SKEW_MS` apart, one older than `ANCHOR_MAX_AGE_MS`, and one that moved more than `MAX_ANCHOR_MOVE_PPM` since the previous poll.
The books, which are the data that actually sets `netPpm`, get `recvTs[i] <= 0` at OpportunityManager.ts:321 and :345.
The pattern was invented, sized in [`../research/2026-09-14-open-guard-sizing.md`](../research/2026-09-14-open-guard-sizing.md) and applied to the once per second REST data, while the millisecond WebSocket data kept a binary flag.

## 1. Nothing measures how old a price is

30 rows, section 2a of the audit.

Two flash crashes at 18:37 and 18:45 produced 30 rows in which one leg was 1.1 to 3.7 seconds behind its own venue's trade tape.
The row is the lagging leg's pre-crash price against the current leg's post-crash price.
The cross did not exist on either venue's clock.

Nothing in the process can see this, for two separate reasons.

The venue's own clock never enters the process.
`publish` at VenueFeed.ts:280 takes `now = Date.now()` and every adapter uses thatf default.
The venue timestamp is parsed into the frame type and then dropped: binance `E` and `T` in `venues/binance/types.ts`, bybit `ts` and `cts`, okx `ts`, kraken `timestamp` on both the snapshot and the delta, coinbase `event_time`.
The coinbase type says so outright, "unused because recvTs is the local clock".
On binance the field is unreachable rather than merely unused, because `DepthFrame` at binance.ts:46 narrows the payload to `s`, `U`, `u`, `pu`, `b` and `a` before the apply path sees it.

Our own clock is never compared to anything either.
`cluster.recvTs` is written on every frame at Engine.ts:200 and is only ever tested for `> 0`.
No line anywhere computes `now - recvTs`.
A leg last updated 3 milliseconds ago and a leg last updated 3 minutes ago are equally eligible, as long as the socket is open.

Two further facts make the hole wider than it looks.

`MIN_CROSS_AGE_MS` does not cover it.
It measures how long our view held the cross, so a leg that is stale and stays stale passes it by definition.
Against a frozen leg the dwell test is passed most easily by the books that are most broken.

The repeat-price branch at Engine.ts:189 refreshes `recvTs` when a frame arrives with an unchanged bid and ask and returns before `validate` runs.
So `recvTs` records that a message arrived, not that the price moved, and a venue that republishes an unchanged touch keeps a leg permanently fresh by the only freshness test that exists.

What is already in hand: `cluster.recvTs[b]`, `cluster.recvTs[a]` and `now` are all in scope at OpportunityManager.ts:110, which is where a book twin of the anchor skew test would sit.
That check costs four lines and catches a frozen leg.
It does not catch a uniformly delayed leg, which is what the 18:37 rows were, and that one needs the venue timestamp plumbed through `publish` plus a per venue clock offset before a threshold can be set honestly.

Size: S for the local skew and age caps, M for the venue timestamp, and the two belong in the same piece of work because the first is only a partial answer.

## 2. The fresh gate has no memory

22 rows, section 2b of the audit.

`readAnchorPair` is a pure function of one sample.
`MIN_NET_PPM` is a hard edge at 5,000 with no margin, no hysteresis and no confirmation.
SIREN bybit-binance was refused as a standing basis 20,364 times with a fresh maximum of 4,998, and then opened eleven rows at 5,009 to 9,082.
LSK was refused 901,748 times and wrote two rows.
13 of the 22 opened under 6,000, so the margin between a refusal and a row was often under 300 ppm.

The route's own history is recorded and then discarded.
`reportRejection` keeps an `occurrenceCount` per pair, route and reason at OpportunityManager.ts:293 and spends it on a log line at :306.
Nothing reads it back.
The comment at clusterOverrides.ts:5 declines the idea explicitly, "A standing basis needs no entry, because the open gate refuses a cross that the anchors explain".
That is true of a basis the anchors explain and false of one that sits 300 ppm from the line.

`isCrossOldEnough` is the closest thing to memory and it does not help here.
Its map is keyed by `PairKey` and not by route, at OpportunityManager.ts:40, so on a five venue cluster the 100 ms clock restarts whenever the best route changes.
It also stores only the first sighting, so nothing requires the fresh edge to have cleared the gate on both the first and the confirming sample.

There is a mechanism reason as well as a statistical one.
A mark is a smoothed function of an index.
A perp excursion or an index dip that the mark has not yet absorbed reads as fresh for exactly as long as the smoothing window, and that is what every one of these 22 rows is.
The closed loop is negative on all 22.

Three checks would each remove most of the class, and they are all small.

A margin plus a confirming sample, held on the `PendingCross` record that already exists.
A dislocation cooldown, so that a route refused as a standing basis inside the last minute must clear the gate across one full anchor refresh on both legs.
A frozen mark test, since these rows open precisely when a mark has not moved while its own perp has.

Size: S each.

## 3. A leg's own book is never read past the touch notional

6 rows, section 2c of the audit.

Six rows carry a kraken leg that held one value for 0.4 to 14.8 seconds on books trading 3,047 to 153,476 dollars a day, several of them with one maker quoting both sides.
Kraken's own spread on those markets is 0.40 to 0.70 percent, which is the same order as the edge the row claims.

The far sides are computed and thrown away.
OpportunityManager.ts:197 and :198 compute `highestBidLegAsk` and `lowestAskLegBid`, the other side of each leg's own book, fee adjusted.
They are carried onto the `Opportunity` object, tracked at open, peak and close, and then dropped at the database boundary, because [`../../server/src/db/conversion.ts`](../../server/src/db/conversion.ts) writes neither.
No gate compares either of them to the claimed edge.
A route whose sell leg is 0.7 percent wide and whose edge is 0.6 percent is not an opportunity, and that comparison is two divisions on a line where both numbers already sit.

`thin_book` is the only book quality gate and it measures the wrong thing for this class.
It tests the notional of the whole profitable region against `MIN_EDGE_NOTIONAL`, so a dust touch above a fat second level passes it while being the price that sets `netPpm`.
It says nothing about maker count, quote age, the venue's own width, the last trade, or the day's volume.

Kraken caps its mark premium at 1 percent.
A kraken leg beyond the cap therefore reads as a fixed 1 percent fresh whatever the book does, which is BAT 2758 exactly.
Nothing detects a saturated anchor, so the fresh gate is not merely uninformative on that leg, it is systematically wrong in the direction that opens rows.

Size: S for the own spread test and the resting size test, M for the saturated mark, and volume and trade age remain the larger items already described in [`2026-09-08-judgment-inputs.md`](./2026-09-08-judgment-inputs.md).

## 4. Feed health never reaches the gate

5 of the 30 rows in section 1 above, plus the reconnect storm behind them.

`binance#linear#0` reconnected 146 times and `binance#linear#1` 47 times in 19 minutes.
ESPORTS 2798 opened 802 ms after its socket was reseeded and died when that socket closed 206 ms later.
1000LUNC 2792 opened 84 ms before its socket closed and has one sample.

Everything needed is already on `SingleSocketConnection` in [`../../server/src/feeds/book/types.ts`](../../server/src/feeds/book/types.ts), which holds `lastMessageAt`, `attempt` and the accepted market set.
None of it is exposed to the engine, so no refusal path can take a transport input.
`markStale` fires only on a socket close, and the silence watch is per connection with ping and pong counting as traffic, on connections carrying 30 to 250 markets.
So a single stalled symbol on an otherwise busy socket is invisible to both.
Binance's idle kill is 240 seconds and coinbase's keepalive is its heartbeat channel, which stamps `lastMessageAt` even when no level2 data is flowing.

The cheapest useful version is a post-reconnect quarantine.
`markStale` at Engine.ts:253 already has `now`, the cluster and the venue index in hand, so one more array beside `recvTs` and one comparison in the two gate helpers would keep a market out of a row until its second snapshot.

Size: S for the quarantine, M for a health record the gate can read.

## 5. A sample that cannot be judged closes nothing

Not an open cause, but it is why the rows that did open lived as long as they did.

2,799 of the 5,032 samples on the 66 rows, 55.6 percent, were blind because a poll inside the row moved more than `MAX_ANCHOR_MOVE_PPM`.
22 rows are at least half blind, and `freshNetPpmAtClose` is null on 15.

`closeReasonFor` at OpportunityLifecycle.ts:320 requires `anchor !== null`, and the parameter's own comment says "null when this sample's anchors could not be read, which closes nothing".
So the fresh close rule is switched off during exactly the fast tape it was built for.
AERO 2795 ran five seconds at 4,000 to 5,000 raw with 164 of its 165 samples blind.

The refusal is also not recorded.
The reason string exists at OpportunityLifecycle.ts:196 and is coerced to null one line later, so the row cannot say why it went blind, and the Prisma `AnchorIssue` enum carries no value for `anchor_moving` or `anchor_no_mark` in any case.

Two rules follow.
Count the consecutive blind samples on the open row, and close a route that has been blind for longer than one anchor cadence.
Record the last refusal reason on the row.

Size: S for the counter and the close rule, M if the counts become columns.

## 6. The residual eight rows

Seven single pair flashes and one converged dislocation are not explained by any of the above.
Five of the seven close positive on the row's own arithmetic, on regions of 1,366 to 5,628 quote units, and the largest is about five dollars of theoretical edge.
The check they need is executability, meaning whether an order could reach the venue before the cross died, and the process has no basis for it.

One measurement already exists and is discarded.
`AnchorPoller` computes the REST round trip per venue every second and logs it as `avgMs` and `maxMs` in `anchor_poll_summary`, and that number never reaches the engine.
That is a floor on reachability, not a model of it, and the honest version needs order acknowledgement times this process never obtains.

Size: L, and it should wait until the first three classes are gone.

## 7. Two latent problems found while reading

`ClusterDepth.writtenAt` has a comment that promises a check nobody wrote.
[`../../server/src/engine/cluster/types.ts`](../../server/src/engine/cluster/types.ts) line 29 reads "A reader refuses depth older than the episode it judges".
There is no such reader.
The field is written at Engine.ts:371, zeroed at Engine.ts:263, and read by no non-test line.
`walkLadders` never touches it, so `thin_book` and every edge sample can be computed from a depth block written arbitrarily long ago.
The identical comment on the anchor block at line 39 is true and its reader is `anchorReading.ts`.
Either the check gets written or the comment gets deleted, because an auditor reading the type today would conclude a depth age gate exists.

Depth is written before the quote is validated.
`Engine.updateBook` calls `writeDepth` at line 137 and `applyQuote` at line 152, and `applyQuote` can reject the frame at line 171.
When it does, the depth arrays describe the new frame while the bid, the ask and `recvTs` still describe the previous one, and nothing marks that they diverged.

## 8. What this would not remove

The five items above do not eliminate the class of false positive.
Replayed against the fifth run's own rows they remove somewhere between two thirds and three quarters of them, and the residual has a different shape from the part they remove.

The wording of the own spread rule decides whether it removes three rows or six.
"Refuse a leg whose own spread exceeds the fresh edge" leaves BAT 2758, SSV 2793 and VELO 2796 open, because their kraken widths of 0.45, 0.40 and 0.48 percent are under their fresh edges of 7,973, 6,511 and 7,067 ppm.
Charging the full own spread as the cost of unwinding refuses all six, at 3,473, 2,511 and 2,267 ppm net.
The second form is the honest one, because a taker who unwinds at market crosses that width again.
It is the same arithmetic as the audit's own closed loop column, which is what proved the rows negative.

A confirmation across one anchor refresh does not remove a sustained basis.
It is about two to four seconds, since bybit and coinbase poll at 2,000 ms and the rest at 1,000 ms.
The eleven SIREN rows ran 0.5 to 193 seconds with the fresh edge decaying from 6,513 to 919 over 92 seconds on row 2763, so the fresh edge was still far above the gate four seconds in.
Those rows open later and still open.
What the confirmation removes is the momentary poke, which is the smaller half of the class.

The part that survives is a route whose anchor is itself wrong.
SIREN's bybit index is a basket of BinanceAlpha, Mexc, Binance_Futures and Binance_Index, and mexc printed 3.7 percent away from alpha because SIREN is disabled on gate and its deposits are disabled on kucoin.
ZIL's okx index sits 22,750 ppm over binance's for the same reason.
A mark derived from a basket nobody can trade is not a reference price, and every test built on the fresh premium inherits that error.
No open side gate fixes it, which is why ONE needed a line in `DENIED_PAIRS` rather than a rule.

A threshold always leaves a band.
A leg age cap at 250 ms admits a 240 ms lag, and 240 ms of a flash crash is several thousand ppm.
The seventh run measured the okx view at 118 to 130 ms behind under no load at all, so the band is not hypothetical.

The eight rows of section 6 are untouched by every item on the list.

## 9. The check that would separate a basis from a dislocation

All 22 rows of section 2 share one property that was observable at open and is recorded nowhere.
Their raw cross had already stood for hours without converging.
SIREN held 0.42 to 0.91 percent raw for the whole run, ZIL 1.2 to 2.6 percent, and LSK bybit-binance was refused 901,748 times as a standing basis.
AKE 2819, the one converged dislocation, had no such history.

So the memory worth keeping per route is not how often we refused it.
It is how long the raw cross has been continuously positive.
A route whose raw cross has stood for minutes is a basis whatever the anchors say today, and a route whose raw cross appeared seconds ago is the only kind that can converge.
That is one timestamp per route, written where `forgetCross` already runs, and it does not depend on the anchors being right.

## 10. Why gates alone cannot converge

Each run has found a class the previous run's gates did not cover, and the gates are being tuned against judgement rather than against a measurement.
There is no label on a row saying whether a taker would have been filled, so there is nothing to tune against.

A closed loop replay would produce that label.
For every row, walk the subsequent book frames and ask what an immediate or cancel order sent at open with a modelled latency would have filled, then unwind it on the other leg and record the result in quote units.
It is not a gate and it refuses nothing.
It turns "was this real" into a number on the row, and only then can a threshold be set by fitting instead of by argument.
The inputs are already recorded, since the series on the row hold both legs over the episode.

## What finishing means

The order below is by rows removed per unit of work, not by size.

1. Book age and book skew at the gate, using `recvTs` and `now`, which are already in scope.
   It removes a frozen leg and is four lines.
2. Memory in the fresh gate: a margin plus a confirming sample, a cooldown after a standing basis refusal, and a frozen mark test.
   It removes the 22 row class.
3. The own spread test on both legs, and the far sides written onto the row.
   It removes the six kraken rows and makes the class visible in every future audit.
4. The venue's exchange timestamp carried onto the book, with a per venue clock offset, then a leg lag refusal.
   It is the only thing that removes the 30 row class, and it is the largest of the four.
5. A post-reconnect quarantine, and a close rule for a route that has been blind for more than one anchor cadence.

Items 1, 2, 3 and 5 need no new data.
Every number they compare is already resident in the cluster or on the `Opportunity` object at the moment the decision is made.
