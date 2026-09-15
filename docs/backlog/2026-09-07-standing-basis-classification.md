# Standing basis classification

Status: Done.
Recorded: 2026-09-07.
Indexed in [BACKLOG.md](../BACKLOG.md).

Replace the hand kept denial of standing basis pairs with a classification from each leg's index, mark and funding.

## Finding

Some pairs show a spread that never converges.
Every episode runs to the five minute age cap and reopens on the next tick, so one persistent basis becomes a stream of five minute rows with the highest ppm in the table.
The walk over the depth block will make these rows look even more capturable, because both books are deep.
Only a comparison of the two legs' index, mark and funding tells such a basis from an arbitrage.

On 2026-09-07 four pairs were added to `DENIED_PAIRS` in `server/src/engine/cluster/clusterOverrides.ts` by hand, so they stop polluting the table while the classification does not exist.

## Evidence

From the third run's 745 rows, the pairs whose episodes end by age cap:

| pair | episodes | age cap closes | mean peak ppm | routes |
|---|---:|---:|---:|---|
| OPENAI\|USDT | 37 | 37 | 20,992 | okx-binance, okx-coinbase |
| ANTHROPIC\|USDT | 33 | 33 | 13,000 | okx-binance, okx-coinbase |
| ONG\|USDT | 33 | 32 | 7,142 | bybit-binance |
| SIREN\|USDT | 27 | 26 | 7,218 | bybit-binance |
| ICX\|USDT | 34 | 12 | 9,930 | four routes |

OPENAI and ANTHROPIC are pre-IPO synthetic markets whose indices are venue specific.
SIREN's two venue indices sit 1.7 percent apart, see the third run audit.
ICX is mixed and was left alone.

## What finishing means

- Each venue feed or a side channel carries the leg's index price, mark price and funding rate into the cluster.
- The cluster builder denies or tags a pair when the venues' indices disagree beyond a threshold, replacing `DENIED_PAIRS` and `PRICE_SCALE`.
- The row carries the index gap and the funding difference at open, so a standing basis is a tag the ranking filters on rather than a hand list.

## Outcome

Done on 2026-09-15 through [issue #3](https://github.com/nemanull/arbitrage-observatory/issues/3), see [`../bestiary/index-mark-and-premium.md`](../bestiary/index-mark-and-premium.md) and [`../implemented/2026-09-14-fresh-edge-verdict-design.md`](../implemented/2026-09-14-fresh-edge-verdict-design.md).
The anchor pollers carry each leg's index, mark and funding into the cluster, which is the first point above.
The other two points were replaced rather than built.
The open gate refuses a cross that the anchors explain as `standing_basis`, so no pair is denied or tagged at cluster build and no ranking needs a basis tag.
OPENAI, ANTHROPIC, ONG and SIREN left `DENIED_PAIRS` on 2026-09-15 together with ONE, after a live probe showed the gate refusing their crosses, see [`../research/2026-09-15-denied-basis-pairs-gate-probe.md`](../research/2026-09-15-denied-basis-pairs-gate-probe.md).
`PRICE_SCALE` stays, since the okx OPENAI and ANTHROPIC contracts still quote a tenth of the unit.
