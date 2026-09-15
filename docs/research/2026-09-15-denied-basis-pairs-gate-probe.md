# Denied basis pairs against the open gate

Date: 2026-09-15, one probe of 90 rounds every 2 s from 00:47:44 to 00:50:42 UTC.
Question: would the open gate refuse OPENAI, ANTHROPIC, ONG, SIREN and ONE if they left `DENIED_PAIRS`?
Background: [`../backlog/2026-09-07-standing-basis-classification.md`](../backlog/2026-09-07-standing-basis-classification.md) for the four pairs denied on 2026-09-07, and [`../bestiary/standing-basis.md`](../bestiary/standing-basis.md) for ONE, denied on 2026-09-06.
Decision that uses this: all five left the list on 2026-09-15, and [issue #3](https://github.com/nemanull/arbitrage-observatory/issues/3) closed.

## Method

[`../../scripts/probes/basis-gate-probe.mjs`](../../scripts/probes/basis-gate-probe.mjs) read each pair on every venue that lists it.
Index and mark came from the endpoints and fields the anchor pollers read, and the touch from each venue's REST ticker.
Each round applied the refusals of `OpportunityManager.validate` in order: a raw cross under 5,000 ppm, a raw cross over 100,000 ppm, a missing index or mark, a moving anchor, and a fresh edge under 5,000 ppm.
Fees were the `VENUE_REGISTRY` rates, and the okx OPENAI and ANTHROPIC prices were scaled by 10 as `PRICE_SCALE` does.
The probe judged every ordered pair of venues, not only the best route.
It counted the moving guard both ways, because its 2 s spacing is not every venue's poll cadence.
The thin book floor was not evaluated, because no route passed the fresh edge test.

## Listings

| pair | binance | bybit | okx | coinbase INTX | krakenfutures |
|---|---|---|---|---|---|
| OPENAI | TRADING, TRADIFI_PERPETUAL | PreLaunch | live, scaled by 10 | TRADING | not listed |
| ANTHROPIC | TRADING, TRADIFI_PERPETUAL | PreLaunch | live, scaled by 10 | TRADING | not listed |
| ONG | TRADING | Trading | not listed | not listed | not listed |
| SIREN | TRADING | Trading | not listed | not listed | not listed |
| ONE | TRADING | Closed | live | not listed | not listed |

No request failed, and no leg lacked an index or a mark in any round.

## Every crossed route

| pair | route, sell then buy | raw cross over 5,000 ppm | raw median, max | fresh median, max | index gap median | passed the fresh edge |
|---|---|---:|---:|---:|---:|---:|
| OPENAI | bybit-binance | 90 of 90 | 29,428, 29,963 | -5,241, -2,405 | 35,979 | 0 |
| OPENAI | bybit-okx | 90 of 90 | 7,330, 7,465 | -4,932, -3,298 | 30,306 | 0 |
| OPENAI | bybit-coinbase | 90 of 90 | 22,340, 22,340 | -10,083, -8,267 | 22,131 | 0 |
| OPENAI | okx-binance | 90 of 90 | 20,750, 21,182 | -1,377, -744 | 5,365 | 0 |
| OPENAI | okx-coinbase | 90 of 90 | 13,275, 13,818 | -6,570, -6,104 | -8,000 | 0 |
| ANTHROPIC | bybit-binance | 90 of 90 | 12,237, 12,241 | -3,608, -3,500 | 15,014 | 0 |
| ANTHROPIC | bybit-coinbase | 90 of 90 | 6,834, 8,099 | -3,484, -3,362 | 7,350 | 0 |
| ANTHROPIC | okx-binance | 90 of 90 | 22,184, 22,316 | -1,023, -1,019 | 14,526 | 0 |
| ANTHROPIC | okx-coinbase | 90 of 90 | 16,961, 18,040 | -946, -806 | 6,869 | 0 |
| ONE | binance-okx | 90 of 90 | 40,545, 41,139 | -567, 344 | 50,426 | 0 |

All values are ppm.
ONG and SIREN were not crossed in any round, because bybit-binance stayed under 5,000 ppm raw.
On OPENAI, ANTHROPIC and ONE the best route of every round was refused as `standing_basis`, or as `anchor_moving` in 1 to 3 rounds per pair when the guard was counted.

## Why the fresh edge stays negative

| pair | venue | bid over mark, median | ask over mark, median | mark over index, median |
|---|---|---:|---:|---:|
| OPENAI | binance | -0.003 % | 0.038 % | 0.000 % |
| OPENAI | bybit | -0.382 % | -0.029 % | -0.103 % |
| OPENAI | okx | -0.013 % | 0.013 % | 1.663 % |
| OPENAI | coinbase | -0.010 % | 0.537 % | -1.138 % |
| ANTHROPIC | binance | -0.016 % | 0.009 % | 0.000 % |
| ANTHROPIC | bybit | -0.253 % | 0.251 % | 0.085 % |
| ANTHROPIC | okx | 0.000 % | 0.005 % | 0.859 % |
| ANTHROPIC | coinbase | -0.379 % | 0.000 % | -0.214 % |
| ONE | binance | 0.087 % | 0.127 % | -0.098 % |
| ONE | okx | -0.030 % | 0.045 % | 0.793 % |

No mark sat more than 0.09 percent outside its own spread.
So the fresh edge carries only the two spreads, the fees and that offset, while the whole cross sits in the index gap and the premiums.
The mark over index column is the standing part, with okx's OPENAI and ANTHROPIC perps held 1.7 and 0.9 percent over their indices and coinbase's OPENAI 1.1 percent under.
A route on these pairs opens only when one book leaves its own mark by about 0.6 percent more than the other book does, which is the dislocation the gate exists to open on.

## Limits

- Three minutes of one evening, read over REST rather than the book sockets.
- The moving guard ran at the probe's 2 s spacing, while the engine polls binance, okx and krakenfutures every 1 s.
- Whether ccxt loads bybit's PreLaunch markets and binance's TRADIFI_PERPETUAL contracts into the clusters was not checked, and the probe included them.
- A fresh spike, a settlement dip or a feed lag can still open a route on these pairs, as on any other pair.
- Bybit has closed its ONE perp, and a delisting market that a venue moves to settlement is [issue #15](https://github.com/nemanull/arbitrage-observatory/issues/15), not this gate.
