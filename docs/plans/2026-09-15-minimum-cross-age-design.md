# Minimum cross age, design

Design of record for refusing a cross that has not existed long enough to reach.
It replaces GitHub issue #12, `MIN_EPISODE_MS`, which is closed as not applicable.

## Problem

Row 2714 of the seventh run opened on a cross that had already ended.
Binance was dumped at 00:12:38.146, Bybit followed within 34 ms, and both feeds delivered their venue's move about 108 ms later.
Our view is always about that far behind, and an order needs about as long again to arrive, so a cross under roughly 200 ms cannot be taken from this machine.

In the seventh run 21 of 39 rows lived under 100 ms.
Only 3 lived between 100 ms and one second, and 15 lived past one second.
Of the 16 rows that reached 150 ms, 15 lived past a second, so the age of a cross predicts whether it survives.

Real time Binance depth makes this worse before it makes it better.
The feed will start delivering prices that live for less than one snapshot interval, which the old channel hid.

## Why not a minimum episode age

Issue #12 proposed dropping a row at close when it lived under a threshold.
That rule cannot exist in a trading engine, because it decides with a fact the engine does not have when it acts: how long the cross turned out to last.
This engine is meant to become a trading engine, so every rule at open has to be one a live trader could run.

The age of a cross is such a rule.
A trader waiting for it is not adding a handicap, it is describing the seat it sits in.

## Decisions

1. `MIN_CROSS_AGE_MS` is 100.
   The user chose 100 over 250 on 2026-09-15.
   It sits under the round trip from this machine, so a cross that dies between 100 ms and 200 ms still opens a row.
   In the seventh run that band held one row of 39.
2. The gate is the last check before a route opens, after the anchors, the standing basis rule and the region floor.
   A refusal keeps its own name, so the existing rejection telemetry does not change shape.
3. A cluster holds at most one pending cross, the best route of its last tick.
   A different best route replaces it and restarts the clock, because the age belongs to the cross and not to the pair.
4. A pending cross that never confirms is reported as `unconfirmed_cross` through the existing suppressed rejection path, with the age it reached and the net ppm at first sight.
5. Confirmation needs a tick.
   A cluster whose every leg goes quiet opens late rather than never, on the next tick either leg sends.
6. A route that closes and crosses again waits the full age again.
   The clock starts when the cross is seen, and a closed route has no cross behind it until the next tick says so.
7. The opening numbers stay the numbers of the tick that opened the row, which is now the confirming tick.
   No column records when the cross was first seen, because the rejection log carries it and a column would need a migration for a number under half a second.

## What it does not do

- It does not judge whether a cross is honest.
  The anchors, the basis rule and the region floor do that, and they run first.
- It does not close anything.
  A row that opens still closes on its own rules.
- It does not change the threshold per venue or per route, even though the true budget differs by venue pair.

## Rejected alternatives

- **Minimum episode age, issue #12.**
  Hindsight, and unavailable to a trading engine. See above.
- **A book jump guard, waiting only after a leg moves sharply.**
  It needs a jump threshold on top of the age, and it misses a cross that appears without a jump.
  The age rule covers both with one condition.
- **Recording every cross and filtering at query time.**
  The user's standing rule is that the table holds no row they would have to explain away.

## Verification

- The seventh run's rows are the sizing evidence, summarised above.
- On the first run after this ships, count `unconfirmed_cross` rejections against rows written, and check no pair opens a row whose first sample sits below `MIN_NET_PPM`.
