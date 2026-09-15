# Five venue integration

Date: 2026-09-15.
Question: what does each of Gate, Bitget, MEXC, Bitstamp and Gemini need before it can join the engine as a venue, and which of them fit the current shape as is?

Scope: the perpetual swaps of each venue, read against the catalog, the fee registry, the book feed and the anchor poller the engine runs today.
The design of record is [`../implemented/2026-09-15-five-venue-research-design.md`](../implemented/2026-09-15-five-venue-research-design.md).
The detail lives in fifteen profiles, three per venue, under [`../profiles/`](../profiles/).
This page compares them and links to the section that holds the evidence.

Every probed number was measured from the development host near Seattle on 2026-09-15.
It is one host on one date, not a distribution.
Section 8 records what was checked twice and how.

## 1. Answer

| venue | verdict | what is missing |
|---|---|---|
| Gate | Fits as is | Deny list entries for index baskets built on Gate's own perpetual, [`gate/rest.md`](../profiles/gate/rest.md) section 4 |
| Bitget | Fits with small feed changes | A market filter, a raw `pong` check, v3 subscribe frames of at most 10 args, [`bitget/websocket.md`](../profiles/bitget/websocket.md) section 8 |
| MEXC | Fits with poller and connector changes | Errors and rate limits arrive as HTTP 200, and CCXT reports a per market web fee the API does not charge, [`mexc/rest.md`](../profiles/mexc/rest.md) section 6 and [`mexc/fees.md`](../profiles/mexc/fees.md) section 9 |
| Bitstamp | Book fits, anchor half fits | No bulk funding call, and seven market hours contracts switch to an internal oracle when their index stops publishing, [`bitstamp/rest.md`](../profiles/bitstamp/rest.md) sections 3 and 4 |
| Gemini | Book fits, anchor does not | No bulk anchor call, a public limit of 120 requests a minute, a funding call of 1.2 to 3.8 s, and a GUSD settlement outside the quote family, [`gemini/rest.md`](../profiles/gemini/rest.md) section 3 |

No venue of the five lets a US operator trade its perpetuals.
That is section 7.

Gate is the one venue that plugs in with a registry entry, a feed and a poller in the shape the existing five already have.
Bitget is next, because every change it needs is inside its own registry entry and feed subclass.
MEXC needs two small changes outside its folder.
Bitstamp and Gemini each need an anchor that is not a one second bulk poll.

## 2. Catalog

| | Gate | Bitget | MEXC | Bitstamp | Gemini |
|---|---|---|---|---|---|
| active swaps CCXT loads | 984 | 852 | 1,184 | 20 | 13 |
| split by settlement | 983 USDT, 1 BTC inverse | 787 USDT, 49 USDC, 9 coin, 7 demo | 1,061 USDT, 78 USDC, 35 USD1, 10 coin | 20 USD | 7 GUSD, 6 USDC |
| `market.id` against socket and anchor | same string everywhere | same string on classic calls and v3 linear, v3 Coin-M differs | same string everywhere | lowercase id, the REST ticker spells `BTC/USD-PERP` | lowercase id, the socket answers lowercase |
| book size unit | contracts of `quanto_multiplier` coins, equal to CCXT `contractSize` | base coin, `contractSize` 1 | contracts, equal to CCXT `contractSize` | base coin, `contractSize` undefined so 1 | base coin, `contractSize` undefined so 1 |
| evidence | [`gate/rest.md`](../profiles/gate/rest.md) section 2 | [`bitget/rest.md`](../profiles/bitget/rest.md) section 2 | [`mexc/rest.md`](../profiles/mexc/rest.md) section 2 | [`bitstamp/rest.md`](../profiles/bitstamp/rest.md) section 2 | [`gemini/rest.md`](../profiles/gemini/rest.md) section 2 |

Five catalog traps came out of the profiles.

1. Bitget's 7 demo markets, such as `SBTCSUSDT`, pass the connector's active swap filter, so the registry needs a `marketFilter` for linear USDT and USDC settlement.
2. Gemini's catalog scrape in CCXT fails silently, so `active`, `contractSize` and precision are undefined.
   If that scrape ever succeeds, `contractSize` becomes the price tick, at `server/node_modules/ccxt/js/src/gemini.js` lines 782 and 822, so a Gemini entry should pin the size to 1.
3. CCXT renames MEXC's GAS, GMT and FLUX bases to GASDAO, GMTTOKEN and FLUX1, at `server/node_modules/ccxt/js/src/mexc.js` lines 904 to 908, so those pairs never cluster with the other venues.
4. MEXC lists 41 contracts with `apiAllowed` false, which the API cannot trade, so the registry needs a filter on `market.info.apiAllowed`.
5. Gate's 9 USD1 perpetuals sit on a settlement path CCXT does not load, and `BTC_USD` reports a `quanto_multiplier` of 0, which CCXT turns into 1.

The quote family in [`../../server/src/engine/cluster/quoteFamily.ts`](../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 13 joins USD, USDC and USDT.
GUSD and USD1 are outside it.
So Gemini's 7 GUSD perpetuals and MEXC's 35 USD1 perpetuals form clusters of their own and are never compared.
Gemini's GUSD and USDC twins publish one identical book, so the 6 USDC twins cover the same markets and nothing is lost.

No venue needs a `PRICE_SCALE` line.
Gate and Bitget already quote `OPENAI_USDT` and `ANTHROPIC_USDT` at about ten times the OKX price, which is the magnitude OKX's scale of 10 produces, see [`../../server/src/engine/cluster/clusterOverrides.ts`](../../server/src/engine/cluster/clusterOverrides.ts) lines 20 to 23.

## 3. Fees

| | Gate | Bitget | MEXC | Bitstamp | Gemini |
|---|---|---|---|---|---|
| VIP 0 perpetual taker | 0.05 % = 500 ppm | 0.06 % = 600 ppm | 0.08 % = 800 ppm on API orders | 0.015 % = 150 ppm | 0.07 % = 700 ppm |
| VIP 0 perpetual maker | 0.02 % = 200 ppm | 0.02 % = 200 ppm | 0.06 % = 600 ppm on API orders | -0.005 % or -0.01 %, a rebate | 0.02 % = 200 ppm |
| what CCXT reports | a literal of 0.0005 | the wire's `takerFeeRate`, 0.0006 on every contract | the wire's web and app rate, 0 to 1,000 ppm per contract | a constant of 0.004 | a constant of 0.004 |
| recommended `takerPpm` | 500 | 600 | 800 | 150 | 700 |
| recommended `ccxtTakerPpm` | unset | unset | unset, with the connector check overridden | 4000 | 4000 |
| evidence | [`gate/fees.md`](../profiles/gate/fees.md) sections 2, 8 and 9 | [`bitget/fees.md`](../profiles/bitget/fees.md) sections 2, 8 and 9 | [`mexc/fees.md`](../profiles/mexc/fees.md) sections 2, 8 and 9 | [`bitstamp/fees.md`](../profiles/bitstamp/fees.md) sections 2, 8 and 9 | [`gemini/fees.md`](../profiles/gemini/fees.md) sections 2, 8 and 9 |

MEXC is the one venue where the rate a trader sees is not the rate the engine would pay.
Since 2026-06-01 08:00 UTC, API orders on every futures pair outside the Innovation Zone pay 0.06 % maker and 0.08 % taker, and that schedule "takes precedence over any rates or promotional offers".
The per contract rate CCXT reads, 200 ppm on `BTC_USDT`, applies to web and app orders only.
The connector compares every market's CCXT fee against one number at [`../../server/src/ccxt/connector.ts`](../../server/src/ccxt/connector.ts) lines 27 to 31, so MEXC would warn on every market unless `isExpectedCcxtTakerPpm` is overridden, as the comment above it already anticipates.

Bitstamp's 150 ppm belongs to two launch programmes with no published end date.
They run until Bitstamp introduces volume tiers.
A registry entry should say so, because the day the tiers land the engine misprices every Bitstamp leg.

Gate applies Points Deduction first whenever the futures account holds Points.
The basic taker rate is then 0.075 %, with an effective cost the fee page puts as low as 0.0225 %, so a trading account should hold no Points or model that fee on its own.
Gate's contracts reply carries a `taker_fee_rate` of 0.00075 on every row, which CCXT's own sample marks as not the rate for regular users, and a poller must not read it.

## 4. Book feed

| | Gate | Bitget | MEXC | Bitstamp | Gemini |
|---|---|---|---|---|---|
| URL | `wss://fx-ws.gateio.ws/v4/ws/usdt` | `wss://ws.bitget.com/v3/ws/public` | `wss://contract.mexc.com/edge` | `wss://ws.bitstamp.net` | `wss://ws.gemini.com?snapshot=-1` |
| channel | `futures.obu`, 50 levels | `books`, full depth | `sub.depth.full`, 20 levels | `order_book_<id>`, up to 100 levels | `<id>@depth@100ms` |
| first frame | a `full` snapshot | a snapshot | a whole book every frame | a whole book every frame, only after the next change | absolute levels |
| continuity rule | `U` equals the last `u` plus one | `pseq` equals the last `seq` | none needed, skip a lower `version` | none needed, skip a lower `microtimestamp` | `U` at or below the last `u`, and `u` above it |
| gaps measured | 0 in 26,292 on 150 contracts | 0 in 107,218 on v3 | 0 in 28,841 merged deltas on 150 contracts | not applicable | 0 in 4,328 |
| keepalive | `futures.ping` every 15 s | the text `ping` every 25 s, answered by a bare `pong` | `{"method":"ping"}` every 15 s, closed at about 60 s without one | `bts:heartbeat` every 20 s | the server pings every 20 s |
| `maxSilenceMs` | 45,000 | 60,000 | 45,000 | 60,000 | 60,000 |
| markets per connection | 150 | 50, with at most 10 args per frame | 150, one subscribe frame per contract | all 20 | all tracked |
| evidence | [`gate/websocket.md`](../profiles/gate/websocket.md) sections 4 and 8 | [`bitget/websocket.md`](../profiles/bitget/websocket.md) sections 4 and 8 | [`mexc/websocket.md`](../profiles/mexc/websocket.md) sections 4 and 8 | [`bitstamp/websocket.md`](../profiles/bitstamp/websocket.md) sections 4 and 8 | [`gemini/websocket.md`](../profiles/gemini/websocket.md) sections 4 and 8 |

Every book channel sent text JSON with no compression, so the feed's refusal of deflate at [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts) line 77 costs nothing on any of them.

Four feed traps matter.

1. Gate, Bitstamp and MEXC acknowledge an unknown or misspelled stream and then stay silent, so a feed should log a subscribed market that sends no book within ten seconds.
2. Bitget answers the keepalive with the bare text `pong`, which `JSON.parse` rejects, so the feed has to test for it first.
3. Bitget's v3 socket closed with 1006 and no error on subscribe frames of 25, 50 and 62 args in the evening run, after taking 62 in the morning, and no such limit is documented.
4. Bitstamp sends no snapshot on subscribe, so a quiet book stays empty until its next change, which took up to 12.1 s on `qqqusd-perp`, and Gemini's thin books held fewer than 20 levels a side.

MEXC's lower latency channel, merged `sub.depth`, sends deltas every 200 ms with no snapshot and needs a REST seed per contract, which is why the full 20 level channel is recommended instead.

## 5. Anchor

| | Gate | Bitget | MEXC | Bitstamp | Gemini |
|---|---|---|---|---|---|
| bulk calls | `GET /futures/usdt/contracts` | `GET /api/v2/mix/market/tickers` and `current-fund-rate` | `GET /api/v1/contract/funding_rate` | `GET /api/v2/ticker/` for index and mark | none |
| funding source | same call | the funding call | same call | `GET /api/v2/funding_rate/{id}/` per market, or the `funding_rate_<id>` socket | `GET /v1/fundingamount/{symbol}` per symbol |
| fits `AnchorPoller` at 1 s | yes | yes, two calls a round | yes, with a reply check | index and mark yes, funding by rotation | no |
| interval field and unit | `funding_interval`, seconds | `fundingRateInterval`, hours | `collectCycle`, hours | none, 8 h constant | derived, 1 h |
| next settlement field | `funding_next_apply`, Unix seconds | `nextUpdate`, Unix ms | `nextSettleTime`, Unix ms | `next_funding_time`, Unix seconds | `nextFundingTimestamp`, Unix ms |
| rate unit | fraction per interval | fraction per interval | fraction per interval | fraction per 8 h, inferred from magnitudes | quote amount per base unit, divide by the mark |
| median round trip | 158 to 165 ms | 123 to 141 ms | 138 to 142 ms | 164 to 299 ms | riskstats 109 to 189 ms, funding 1.2 to 3.8 s |
| evidence | [`gate/rest.md`](../profiles/gate/rest.md) sections 3 and 8 | [`bitget/rest.md`](../profiles/bitget/rest.md) sections 3 and 8 | [`mexc/rest.md`](../profiles/mexc/rest.md) sections 3 and 8 | [`bitstamp/rest.md`](../profiles/bitstamp/rest.md) sections 3 and 8 | [`gemini/rest.md`](../profiles/gemini/rest.md) sections 3 and 8 |

The reader at [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) lines 4 to 6 refuses legs read more than 5 s apart, readings older than 10 s, and anchors that moved more than 1,000 ppm in one poll.
Three venues press against those numbers.

1. Gemini's index republishes about every 5 s, which is the whole skew budget, and its mark premium sat pinned at one of two edges exactly 1,000 ppm apart, so a flip between them is a 1,000 ppm move in one poll.
2. Bitstamp's thin crypto indices move in coarse steps, one AVAX step was 2,271 ppm, which trips the moving anchor guard on an index that did not move that far.
3. MEXC reports errors, including its rate limit code 510, with HTTP 200 and `success` false, and [`../../server/src/shared/errors.ts`](../../server/src/shared/errors.ts) line 1 pauses only on 403, 418 and 429.

### Index and mark shapes that have produced false rows before

The ONE row showed that a basket built on the venue's own perpetual turns the fresh premium into momentum, see [`2026-09-15-one-self-index-fresh-gate.md`](./2026-09-15-one-self-index-fresh-gate.md).
The POWR row showed that a capped mark reads a capped leg as fresh.
Every one of the five has a form of one or both.

| venue | own market in the index | mark cap | mark equal to the last trade |
|---|---|---|---|
| Gate | Gate's perpetual in 20 crypto baskets, `NES_USDT` at 0.8, and in 295 TradFi baskets. `NES_USDT`, `EDGE_USDT`, `SCRT_USDT`, `SPACEHOOD_USDT`, `ONE_USDT`, `TAIKO_USDT`, `GT_USDT` and `FONE_USDT` are mostly Gate or a third or more its perpetual | 3 % on TradFi, unpublished on crypto | on 345 to 432 of 983 contracts |
| Bitget | `BITGET_FUTURE` in 48 crypto baskets, 19 at a weight of 0.3 or more, `UBUSDT` at 0.87, `ONEUSDT` at 0.6 | none published, premium p99 7,225 to 14,265 ppm | on 235 to 351 of 787 rows |
| MEXC | `MEXC_FUTURE` in 240 of 1,184 baskets, only source on `YMTCSTOCK_USDT` and `KIMISTOCK_USDT` | `priceCoefficientVariation` looks like one, from a single reading | the mark is a median that includes the last trade |
| Bitstamp | an internal oracle from Bitstamp's own book replaces the index on 7 market hours contracts while it is closed | 10 % of the oracle while the oracle runs, none otherwise | not observed |
| Gemini | the basket is unpublished | about 0.05 % around the index, inferred from the wire | not observed |

Evidence is section 4 of each venue's `rest.md`.
None of these was turned into a `DENIED_PAIRS` line, because that is a decision for a design.
The existing line for `ONE|USDT` already removes the Gate and Bitget ONE baskets.

## 6. What the engine would have to change

These are the changes outside a venue's own folder that the five profiles add up to.
Each one is a finding for a later design, not a decision.

1. The quote family decides whether GUSD and USD1 join USD, USDC and USDT, [`gemini/rest.md`](../profiles/gemini/rest.md) section 2 and [`mexc/rest.md`](../profiles/mexc/rest.md) section 2.
2. `AnchorPoller` needs a way for a venue to fail a round that arrived as HTTP 200, and to mark it rate limited, for MEXC.
3. The anchor needs a second shape beside the one second bulk poll, either a per symbol rotation or a socket source, for Bitstamp funding and for all of Gemini.
4. A refusal for legs whose index is built on the venue's own market, generalising the ONE line, for Gate, Bitget, MEXC and Bitstamp's closed windows.
5. A saturated mark rule for venues whose mark is capped, which the POWR row already asked for on kraken, for Gate TradFi, Gemini and possibly MEXC.
6. A ticker collision survey against the running five, which no researcher did.
   Bitget lists `BBUSDT` and `QNTUSDT`, whose tokens were not identified, and Bitstamp's `GOLD` and `SILVER` may not price the same quantity as Coinbase's.

## 7. Access

| venue | perpetuals offered by | who may trade | US persons | ordinary API futures orders |
|---|---|---|---|---|
| Gate | Gate | outside the restricted list | restricted | Not verified |
| Bitget | BTG Technology Holdings Limited | outside the prohibited list | prohibited | not investigated |
| MEXC | MEXC | KYC verified accounts outside the prohibited list | prohibited | open since 2026-03-31, 800 ppm taker |
| Bitstamp | Bitstamp Financial Services Ltd., a MiFID investment firm in Ljubljana | eligible EU traders | excluded | not investigated |
| Gemini | Gemini Artemis Pte. Ltd. for GUSD, Gemini Intergalactic EU Artemis, Ltd. for USDC | 14 non EU countries for GUSD, EU and EEA for USDC | excluded | not investigated |

Every public endpoint answered from this host, so observation is open on all five.
Trading is not, from this host, on any of them.
Gemini put UK and EU accounts into withdrawal only mode from 5 March 2026, while its USDC perpetuals still read `open`, so the USDC entity's future is unclear.
Evidence is section 1 of each venue's `fees.md`.

## 8. How this was verified

The profiles were written by one researcher per venue on 2026-09-15 and checked by a second agent pass the same evening, which reran every probe, reread every source and recorded its corrections in place.

The main session then checked the claims a feed or a poller would break on, with its own scripts rather than the researchers'.

| venue | CCXT id against anchor keys | size unit | anchor fields and units | book continuity | VIP 0 taker on the official page |
|---|---|---|---|---|---|
| Gate | 983 of 983 | `contractSize` 0.0001 equals `quanto_multiplier` | yes | 2,548 deltas, 0 gaps | 500 ppm, fee page rendered in headless Chrome |
| Bitget | every USDT id present | `contractSize` 1 | yes | 826 v3 updates, 0 gaps | not rendered, the wire's `takerFeeRate` read 0.0006 |
| MEXC | every id present | `contractSize` 0.0001, integer sizes | yes | 195 merged deltas, 0 gaps, text frames | 800 ppm API taker, announcement read |
| Bitstamp | 20 of 20 after the spelling change | base units | index and mark yes, funding per market | 86 whole books, rising `microtimestamp` | not rendered, the second pass rendered it |
| Gemini | 13 ids read | base units | yes, funding derived from the amount | 739 of 739 frames began at the previous `u` | 700 ppm, derivatives fee table read |

Two numbers rest on one check each.
Bitget's 600 ppm rests on the second pass's reading of the fee FAQ and on the wire.
Bitstamp's 150 ppm rests on the second pass's rendering of the derivatives fee schedule.

The probe scripts are in [`../../scripts/probes/`](../../scripts/probes/): `gate-venue-probe.mjs`, `gate-ws-probe.mjs`, `bitget-rest-probe.mjs`, `bitget-ws-probe.mjs`, `bitget-settlement-probe.mjs`, `mexc-rest-probe.mjs`, `mexc-ws-probe.mjs`, `bitstamp-venue-probe.mjs`, `bitstamp-ws-probe.mjs`, `bitstamp-settlement-probe.mjs`, `gemini-venue-probe.mjs` and `gemini-ws-probe.mjs`.
Each is public, unauthenticated and read-only.

## 9. Open questions

- Gate: which status and body the 200 per 10 s limit returns, and whether ordinary accounts may place futures orders over the API, [`gate/rest.md`](../profiles/gate/rest.md) section 6 and [`gate/fees.md`](../profiles/gate/fees.md) section 1.
- Bitget: why v3 closed on subscribe frames of 25 args or more in one run and not the other, [`bitget/websocket.md`](../profiles/bitget/websocket.md) section 5.
- MEXC: whether `MEXC_FUTURE` in a basket means the same contract, and whether `priceCoefficientVariation` clamps the mark, [`mexc/rest.md`](../profiles/mexc/rest.md) section 4.
- Bitstamp: why WTI and BRENT settled at exactly 0 on 100 consecutive settlements, and whether the ticker's `index_price` is the oracle during a closed window, [`bitstamp/rest.md`](../profiles/bitstamp/rest.md) section 4.
- Gemini: whether the mark is clamped at about 0.05 %, and whether an EU customer can still open a USDC perpetual, [`gemini/rest.md`](../profiles/gemini/rest.md) section 4 and [`gemini/fees.md`](../profiles/gemini/fees.md) section 1.
- All five: what the book channel sends for a one sided, empty or delisted book, which no probe observed.
