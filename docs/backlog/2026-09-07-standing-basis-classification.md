# Standing basis classification

Status: Not started.
Recorded: 2026-09-07.
Indexed in [BACKLOG.md](../BACKLOG.md).

Replace the hand kept denial of standing basis pairs with a classification from each leg's index, mark and funding.

## Finding

Some pairs show a spread that never converges.
Every episode runs to the five minute age cap and reopens on the next tick, so one persistent basis becomes a stream of five minute rows with the highest ppm in the table.
The walk over the depth block will make these rows look even more capturable, because both books are deep.
Only a comparison of the two legs' index, mark and funding tells such a basis from an arbitrage.

On 2026-09-07 four pairs were added to `DENIED_PAIRS` in `server/src/engine/clusterOverrides.ts` by hand, so they stop polluting the table while the classification does not exist.

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
