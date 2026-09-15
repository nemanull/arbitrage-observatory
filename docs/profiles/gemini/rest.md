# Gemini REST Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

Probed numbers come from [`gemini-venue-probe.mjs`](../../../scripts/probes/gemini-venue-probe.mjs), run from `server/` between 07:11 and 07:18 UTC, and from the `anchorcheck` and `settle` sections of [`gemini-ws-probe.mjs`](../../../scripts/probes/gemini-ws-probe.mjs).
The book socket is in [`websocket.md`](./websocket.md), and fees and funding costs are in [`fees.md`](./fees.md).
The second pass reran the venue probe from 19:03 to 19:09 UTC, the socket probe with `anchorcheck` from 19:09 to 19:12 UTC, and the `settle` section across 19:00 UTC.
Request starts were spaced at least 550 ms apart, and no probe exceeded 75 requests per minute against the published 120.
Latency and cadence numbers are one host on one date.

## 1. Host and latency

| Item | Value | Evidence |
| --- | --- | --- |
| REST host | `https://api.gemini.com` | [R1] |
| DNS | CNAME `prod-dc-alb-backup-2004476785.us-east-1.elb.amazonaws.com`, six A records: 52.4.208.191, 3.209.208.119, 54.144.175.186, 18.213.158.226, 23.22.11.39, 3.226.210.197 | Probed |
| WebSocket host | `ws.gemini.com`, one A record 3.234.90.77, no CNAME | Probed |
| Hosting | AWS us-east-1, named by the CNAME and stated by Gemini for the public WebSocket tier | Probed CNAME, [W1] in [`websocket.md`](./websocket.md) |
| Backends | `server: istio-envoy` on symbols, details and book, `server: nginx` on riskstats and fundingamount | Probed |

TCP connect took about 13 ms to every venue host tried from this sandbox, including hosts on other continents, so it is not a round trip measure here.
The round trip is better read from the TLS handshake of about 210 to 240 ms and from the WebSocket application ping of 64 to 65 ms, and 75 to 78 ms in the second pass.

Latency, one cold request on a new TLS connection then five warm requests on the kept connection, at 07:11 UTC (Probed).

| Call | Bytes | Cold TLS ms | Cold first byte ms | Cold total ms | Warm total ms |
| --- | ---: | ---: | ---: | ---: | --- |
| `/v1/symbols` | 3,710 | 214 | 309 | 311 | 344, 85, 79, 325, 78 |
| `/v1/riskstats/btcgusdperp` | 159 | 237 | 363 | 363 | 121, 138, 212, 211, 150 |
| `/v1/fundingamount/btcgusdperp` | 205 | 212 | 3,486 | 3,486 | 3,177, 3,071, 3,257, 3,072, 3,179 |
| `/v1/book/btcgusdperp?limit_bids=20&limit_asks=20` | 2,065 | 253 | 336 | 336 | 72, 80, 73, 71, 74 |

The first warm `/v1/symbols` request opened a new connection, and the fourth paid a stall on the kept one.
A second run at 07:35 UTC read warm `fundingamount` at 1,636 to 1,761 ms and warm `riskstats` at 108 to 438 ms (Probed).
The second pass at 19:03 UTC read cold totals of 326, 727, 3,025 and 376 ms on the four calls, and warm `fundingamount` at 2,730 to 3,383 ms (Probed).
`fundingamount` is slow on some symbols and at some times, see section 3.

## 2. Catalog

### 2.1 Instruments call and status values

| Call | Content | Evidence |
| --- | --- | --- |
| `GET /v1/symbols` | Array of lowercase symbol strings, 347 symbols, 3,710 bytes | [R1], Probed |
| `GET /v1/symbols/details/{symbol}` | One symbol per call: `symbol` uppercase, `base_currency`, `quote_currency`, `tick_size` (base decimals), `quote_increment` (price tick), `min_order_size`, `status`, `product_type`, `contract_type`, `contract_price_currency` | [R1], Probed |
| `status` values | `open`, `closed`, `cancel_only`, `post_only`, `limit_only` | [R1] |
| Bulk details call | None found, `/v1/symbols` carries no status and no contract fields | Probed |

Perpetuals are the symbols ending in `perp`, with `product_type: swap` and `contract_type: linear` (Probed).

| Symbol | Quote | `contract_price_currency` | `tick_size` | `quote_increment` | `min_order_size` | Status |
| --- | --- | --- | --- | --- | --- | --- |
| avaxgusdperp | GUSD | GUSD | 0.1 | 0.001 | 0.1 | open |
| avaxusdcperp | USDC | USDC | 0.1 | 0.001 | 0.1 | open |
| btcgusdperp | GUSD | GUSD | 0.0001 | 0.5 | 0.0001 | open |
| btcusdcperp | USDC | GUSD | 0.0001 | 0.5 | 0.0001 | open |
| ethgusdperp | GUSD | GUSD | 0.001 | 0.05 | 0.001 | open |
| ethusdcperp | USDC | GUSD | 0.001 | 0.05 | 0.001 | open |
| hypegusdperp | GUSD | GUSD | 0.1 | 0.001 | 0.1 | open |
| hypeusdcperp | USDC | USDC | 0.1 | 0.001 | 0.1 | open |
| solgusdperp | GUSD | GUSD | 0.1 | 0.005 | 0.1 | open |
| solusdcperp | USDC | GUSD | 0.1 | 0.005 | 0.1 | open |
| trumpgusdperp | GUSD | GUSD | 0.001 | 0.001 | 0.1 | open |
| xrpgusdperp | GUSD | GUSD | 1 | 0.0001 | 1 | open |
| xrpusdcperp | USDC | GUSD | 1 | 0.0001 | 1 | open |

Four USDC perpetuals report `contract_price_currency: GUSD` on the wire, while the support center says EU and EEA customers settle in USDC [F3] in [`fees.md`](./fees.md).
The support table gives TRUMP a price tick of GUSD 0.01 [F10], while the wire says `quote_increment: 0.001` and the book quotes 1.958 and 1.960.
The wire is what a feed must handle.

Active perpetuals by settlement asset: 7 GUSD linear and 6 USDC linear, 13 in total (Probed).

### 2.2 How CCXT maps it

CCXT 4.5.68 `loadMarkets` took 1,531 ms and returned 344 markets, 331 spot and 13 active swaps with the connector's filter (Probed).
The second pass returned the same counts in 1,621 ms, with the same `303` to `/signin` on the scrape.

| Field | CCXT value for BTC | CCXT value for TRUMP | Source in `server/node_modules/ccxt/js/src/gemini.js` |
| --- | --- | --- | --- |
| `id` | `btcgusdperp` | `trumpgusdperp` | the raw `/v1/symbols` string, `:711` and `:778` |
| `symbol` | `BTC/GUSD:GUSD` | `TRUMP/GUSD:GUSD` | `:818` to `:821` |
| `base`, `quote`, `settle` | BTC, GUSD, GUSD | TRUMP, GUSD, GUSD | quote matched against `quoteCurrencies` at `:296`, settle set to the quote at `:808` |
| `linear` | true | true | `:823` |
| `active` | undefined, kept by `active !== false` | undefined | status is only read from a details reply, `:770` |
| `contractSize` | undefined | undefined | `:822` sets it to `tickSize`, which is undefined on this path |
| `precision.price`, `precision.amount` | undefined | undefined | only set from a details or trading pairs reply, `:766` to `:785` |
| `taker`, `maker` | 0.004, 0.002 | 0.004, 0.002 | `:228` and `:229`, see [`fees.md`](./fees.md) section 8 |

Why the fields are empty.
`loadMarkets` calls `fetchCurrencies` first, at `server/node_modules/ccxt/js/src/base/Exchange.js:1186`.
Gemini's `fetchCurrencies` scrapes `https://exchange.gemini.com` for a `currencyData` script, at `gemini.js:420`.
That page answered `303` to `/signin` from this host, and the failure is muted by `webApiMuteFailure: true` at `:306` (Probed).
With no `tradingPairs` option, `fetchMarketsFromAPI` parses the bare id strings, at `:708` to `:713`.

A trap in the same code.
If the scrape ever succeeds, `:782` sets `tickSize` from the price decimals and `:822` copies it into `contractSize`.
BTC would then carry a contract size equal to its price tick rather than 1, and the engine would scale every book size by it.
This path is read from code only and is Not verified on the wire.
A registry entry should pin the contract size to 1 or check it at boot.

### 2.3 `market.id` against the socket and the anchor

| Place | Spelling | Evidence |
| --- | --- | --- |
| CCXT `market.id` | `btcgusdperp` | Probed |
| Current socket `s` | `btcgusdperp`, also when subscribed in uppercase | Probed |
| REST path | Either case accepted | Probed |
| `fundingamount` reply `symbol` | Echoes the request case | Probed |
| `riskstats` reply | No symbol key at all, the row is keyed by the request | Probed |
| Archived v2 socket | Uppercase only, lowercase answers `NoValidTradingPairs` | Probed |

So `rawMarketId` equal to CCXT `market.id` works for the current socket and for REST, and a v2 consumer must uppercase it.

### 2.4 Contract size against the book size unit

The book size is in base units, and one contract is one base unit.
`open_interest` 18.2696 times mark 77,244.69 equals `open_interest_notional` 1,411,229.5883 (Probed).
The second pass found the same identity on all 13 perpetuals, as BTC 18.5719 times 76,002.811 gives 1,411,516.6055.
The socket book equalled the REST `amount` on 33 of 33 BTC levels and 20 of 20 TRUMP levels, see [`websocket.md`](./websocket.md) section 4.6.
The connector's fallback of 1 for an undefined contract size, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 180 to 186, is therefore correct.

### 2.5 Pairs listed twice

AVAX, BTC, ETH, HYPE, SOL and XRP each list a GUSD and a USDC perpetual.
The two symbols of a pair publish one order book (Probed).

- On the socket, `btcgusdperp` and `btcusdcperp` sent the same number of frames with identical `E`, `U`, `u` and levels, and so did every other pair.
- `fundingAmount` and `estimatedFundingAmount` were identical within each pair on all six.
- `open_interest` was the same on both symbols of each pair, for example 18.2696 on BTC and 57,212 on XRP at 07:37 UTC, and 18.5719 and 52,590 at 19:09 UTC.
- The index differed slightly within some pairs, for example ETH 2480.176 and 2480.381, and HYPE 79.075273 and 79.087691.

In the engine today the two do not collide.
GUSD is not in the quote family at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a GUSD market sits in its own `BTC|GUSD` pair.
No other venue lists a GUSD perpetual, and a pair with fewer than two markets makes no cluster, at [`ClusterIndexBuilder.ts`](../../../server/src/engine/cluster/ClusterIndexBuilder.ts) line 143.
So as the code stands only the six USDC perpetuals would join clusters, and TRUMP, which has no USDC twin, would join none.
If GUSD were added to the family, both twins would land on one pair and `marketRank` would keep the USDC one, at `quoteFamily.ts` lines 13 to 17.

### 2.6 Price scale and ticker aliases

No perpetual is quoted per 10 or per 1000 units, and every base is a plain ticker: AVAX, BTC, ETH, HYPE, SOL, TRUMP, XRP (Probed).
None of these tickers is in `DENIED_PAIRS` at [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) lines 7 to 12.
Whether any of them names a different token on another venue was not checked.

## 3. Anchor

### 3.1 No bulk call

No public REST call returns index, mark and funding for every perpetual at once.

| Tried | Result |
| --- | --- |
| `GET /v1/riskstats` | 404 `EndpointNotFound` |
| `GET /v1/fundingamount` | 404 `EndpointNotFound` |
| `GET /v1/pricefeed` | 200, about 23 KB, all 347 pairs including the perpetuals, but only `price` and `percentChange24h` |
| `GET /v2/ticker/{symbol}`, `/v1/pubticker/{symbol}` | Per symbol, bid, ask, last and volume, no anchor fields |

The anchor needs two per-symbol calls [R1] [R2] [R3].

| Call | Fields | Reply | Warm time |
| --- | --- | --- | --- |
| `GET /v1/riskstats/{symbol}` | `product_type`, `mark_price`, `index_price`, `open_interest`, `open_interest_notional`, all strings | 155 to 159 bytes | median 109 to 135 ms, p90 175 to 257 ms, max 1,688 ms over 240 polls. Second pass: median 171 to 189 ms, p90 254 to 671 ms, max 1,270 ms over 240 polls |
| `GET /v1/fundingamount/{symbol}` | `symbol`, `fundingDateTime`, `fundingTimestampMilliSecs`, `nextFundingTimestamp`, `fundingAmount`, `estimatedFundingAmount`, numbers | 205 bytes | median 416 ms on BTC and 420 ms on TRUMP, 2,442 ms on AVAX USDC, 2,972 ms on ETH, max 3,528 ms over 48 polls. Second pass: median 2,890 ms on BTC, 2,873 on ETH, 2,991 on TRUMP, 1,994 on AVAX USDC, max 3,762 ms over 48 polls |
| `GET /v1/nextfundingtimestamp/{symbol}` | One integer, Unix ms | 13 bytes | 0.3 to 3.1 s |

The funding call answered in 2.2 to 3.5 s on some symbols for whole minutes, and in 0.3 to 0.9 s on others, with the same symbol switching between the two over time (Probed).
In the second pass none of 86 funding reads came back under a second, and they took 1.2 to 3.8 s (Probed).
That is slower than the 2 s the reader can absorb, see [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) lines 4 to 6.

Gemini lists 13 perpetuals, 7 GUSD and 6 USDC, and every anchor call names one symbol.
At the engine's one second cadence, [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) line 34, a full round would cost these request rates against the published public limit of 120 per minute [R4].

| round each second | requests per minute | against 120 per minute |
| --- | ---: | --- |
| `riskstats` and `fundingamount` for all 13 | 1,560 | 13 times over |
| `riskstats` for all 13 | 780 | 6.5 times over |
| `riskstats` for the 6 USDC perpetuals, the ones that can join a cluster today, see section 2.5 | 360 | 3 times over |

Inside the limit, `riskstats` for the 6 USDC perpetuals fits once every 3 s, or once every 6 s at the recommended one request per second.
A full round of all 26 requests fits at most once every 13 s, and at one request per second once every 26 s.
The funding call cannot meet a one second cadence on any symbol, because a single reply takes 1.2 to 3.8 s.

### 3.2 Mapping to `AnchorRow`

| `AnchorRow` column | Source | Conversion |
| --- | --- | --- |
| `index` | `riskstats.index_price` | `Number` |
| `mark` | `riskstats.mark_price` | `Number` |
| `fundingRate` | `fundingamount.estimatedFundingAmount` | divide by the mark, because it is quote currency per 1 base unit for the upcoming hour |
| `fundingIntervalHours` | `nextFundingTimestamp` minus `fundingTimestampMilliSecs` | divide by 3,600,000, which gave 1 on all 13 |
| `nextFundingAt` | `fundingamount.nextFundingTimestamp` | already Unix ms |

The schema names the settled amount field `amount`, while its own example and the wire use `fundingAmount` [R1] (Probed).
The wire is what a poller must handle.

### 3.3 Socket alternatives

The same numbers also arrive by socket, without a request budget.

| Source | Carries | Cadence probed | Caveat |
| --- | --- | --- | --- |
| Archived v2 `mark_price` | `mark_price`, `spot_index`, ns `timestamp` | a frame when the mark changes, 1 to 5 s on active symbols | No frame when only the index moves, so the index goes stale: XRP's last frame was 38 s old and its `spot_index` 183 ppm off the REST index |
| Archived v2 `funding_amount` | `funding_amount` for the next settlement, `funding_date_time` in ns, `funding_interval_in_minutes`, `is_realized`, plus undocumented `funding_rate` and `mark_price` | on subscribe and at each minute | Archived [W7] |
| Current `@markPrice` | `p` mark, `i` | 1 s on ETH, 4 to 5 s on most others | Undocumented, `i` is off by a symbol-specific power of ten, see [`websocket.md`](./websocket.md) section 4.8 |
| Current `@fundingAmount` | `T`, `i`, `f`, `r`, `p`, `R` | at each minute | Undocumented |

Against 14 REST `riskstats` reads, the latest v2 mark was equal on 14 and the v2 index on 11, and the three index misses came from frames 22 to 38 s old (Probed, `anchorcheck` at 07:30 UTC).
The second pass at 19:11 UTC read the mark equal on 12 of 14 and the index on 13, and its misses came from frames 57 and 274 ms old, which is a race between the two reads rather than a stale stream.

The rate fields are percent per interval and lose precision on some symbols.
On five symbols `r` equalled `f / p * 100` to the printed digits, for example XRP `r` -0.00449 against -0.004490 (Probed).
On BTC `r` was `0.01000` against 0.010229, and on ETH `0.00100` against 0.001446, and v2 `funding_rate` showed the same truncation (Probed).
The second pass saw it again, BTC `r` `0.00600` against 0.006978 and ETH `-0.00600` against -0.006082, while XRP, SOL, AVAX, HYPE and TRUMP kept full precision (Probed).
So the rate should be computed from the amount and the mark, never read from `r` or `funding_rate`.

## 4. Anchor semantics

### 4.1 Index

- Definition: "the spot index published by the Company, as determined and/or calculated by an independent third-party provider, with reference to the Index Constituents" [F13] clause 2.
- Basket and weights: Not publicly specified.
- Basket call: none found in the REST specification [R1].
- A single-source basket or a self-referencing basket cannot be ruled out, because the constituents are not published.
- Tried: the REST and WebSocket specifications, the support center searches for "index price", "spot index" and "index constituents", and both Artemis user agreements.

### 4.2 Mark

- Definition: "an estimated fair value of a Perpetual Contract, as determined by the Company in its sole and absolute discretion" [F13] clause 2.
- Formula and clamps: Not publicly specified, the agreement defers to the Contract Specifications [F13] clause 11.5, and no public Contract Specification page was found.
- The support article on the mark gives its uses and no formula [R5].

Observed, and a reason for caution.
Over 60 one second polls the BTC mark sat 581 to 582 ppm above the index on every poll, while the index itself moved 12 times (Probed).
AVAX USDC sat at its highest, 581 ppm, on 27 of 60 polls, ETH peaked at 528 ppm on 10 polls, and TRUMP sat at 511 ppm on 49 of 60 polls.
In the `anchorcheck` reads about 35 s apart at 07:30 UTC, BTC read 581 ppm twice, ETH 528 twice, HYPE -519 twice and TRUMP -489 twice, while each index moved between the reads (Probed).
In the full round at 07:37 UTC BTC read 582 ppm on both twins although their marks differed by 9.7, AVAX read 581 on both, and TRUMP read 511 (Probed).
The second pass at 19:05 UTC showed the same shape: BTC at 578 or 579 ppm on 43 of 60 polls, ETH at 502 on 41, TRUMP at -426 on 52, and AVAX USDC at -526 or -527 on all 60 (Probed).
It also showed where the premium goes when it leaves one pinned value.
ETH jumped between 502 and -498 ppm, and TRUMP between -426 and 574 ppm, two values exactly 1,000 ppm apart each time.
When pinned, the mark carried more decimals than the book tick, as TRUMP 1.910086 against an index of 1.9109, and when free it sat on a book price, as ETH 2402.50.
A premium pinned at one of two edges 1,000 ppm apart, while the index moves, is the shape a clamp of about ±0.05 % around a reference near the index produces.
A clamp is not published, so this is Not verified, and a capped mark would read a capped leg as fresh, the failure named in the design.
A jump between the two edges is also a 1,000 ppm mark move in one poll, the size of the reader's move guard.

### 4.3 Funding

The formula, direction, interval and unit are in [`fees.md`](./fees.md) section 6.
The points that matter for the poller:

| Question | Answer | Evidence |
| --- | --- | --- |
| Cap and floor | Not publicly specified | [F7], [F8], [F13] |
| Interest component | None in the published formula | [F7] |
| Interval in use | 60 minutes on all 13, settlements on the hour | Probed |
| Does it vary per contract | Not observed, all 13 read 60 | Probed |
| `fundingAmount` | The amount of the last settlement, at `fundingDateTime` and `fundingTimestampMilliSecs`, which lie in the past | Probed, [R1] |
| `estimatedFundingAmount` | The estimate for the next hour, settling at `nextFundingTimestamp` | [R1] schema, Probed |
| Unit | Quote currency per long position of 1 base unit, not a fraction | [F7], [R1] |
| How often the estimate changes | Once a minute | Probed |

REST lagged the sockets by about 16 to 21 s, and by about 20 s again in the second pass.
The four REST series changed their estimate between 07:14:11 and 07:14:16, 07:15:16 and 07:15:20, 07:16:16 and 07:16:20, and 07:17:16 and 07:17:21 UTC, while both sockets sent the new amount at 07:20:00 (Probed).

### 4.4 Settlement instant

Probed with the `settle` section of [`gemini-ws-probe.mjs`](../../../scripts/probes/gemini-ws-probe.mjs) from 18:59:59 to 19:03:00 UTC on 2026-09-15, on BTC and TRUMP GUSD, with both funding streams and the REST funding call every 10 s.

| UTC | source | BTC |
| --- | --- | --- |
| 18:59:59.665 | v2 `funding_amount` | `funding_amount` 6.00522 for 19:00, `is_realized` false |
| 19:00:00.000 | current `@fundingAmount` and v2 | `f` 5.96835 with `R` true, and v2 `is_realized` true, mark 76017.432 |
| 19:00:02 and 19:00:12 | REST `fundingamount` | still `fundingAmount` 3.01179 for 18:00, `estimatedFundingAmount` 6.00522, `nextFundingTimestamp` 19:00 |
| 19:00:22 | REST `fundingamount` | `fundingAmount` 5.96835 for 19:00, `nextFundingTimestamp` 20:00, `estimatedFundingAmount` still 6.00522 |
| 19:01:00 | both sockets | first estimate for 20:00, 4.53322 |
| 19:01:22 | REST `fundingamount` | `estimatedFundingAmount` 4.53322 |

- The settled amount, 5.96835, was not the last estimate, 6.00522, which was 0.6 % higher.
  TRUMP settled at 0.000142416 against a last estimate of 0.000149208.
- Both sockets mark the settlement with a frame whose `R` or `is_realized` is true, stamped on the hour.
- REST kept the previous settlement and a `nextFundingTimestamp` in the past for 10 to 20 s after the hour, given the 2.8 s each reply took.
- After it rolled, REST still showed the settled hour's estimate as the next hour's for about 80 s, until the first new estimate arrived with its usual 20 s lag.
- So a REST poller reads a stale or past-dated funding row for roughly the first 80 s of every hour, and should drop the funding columns while `nextFundingTimestamp` is not in the future or the estimate has not changed since the hour.
- The REST funding call took 2.8 to 3.2 s on every read across the hour.

### 4.5 How often each number changes

60 polls at 1 Hz of `riskstats` and 12 polls every 5 s of `fundingamount` per symbol (Probed, 07:13 to 07:17 UTC).

| Symbol | Index changes | Mark changes | Estimate changes | Largest index or mark move per poll |
| --- | ---: | ---: | ---: | ---: |
| btcgusdperp | 12 | 12 | 1 | 218 ppm |
| ethgusdperp | 12 | 36 | 1 | 161 ppm |
| trumpgusdperp | 10 | 9 | 1 | 307 ppm |
| avaxusdcperp | 11 | 20 | 1 | 400 ppm |

The index changed about every 5 s on all four, and in the morning run the BTC mark changed only with it.
The second pass at 19:04 UTC read 12, 12, 11 and 11 index changes, 24, 32, 14 and 11 mark changes, 1 estimate change each, and largest moves of 660, 1,000, 1,000 and 417 ppm on the same four symbols.
The two 1,000 ppm moves are the premium jumps of section 4.2.
A Gemini reading can therefore be up to about 5 s old when it is read, which sits inside the reader's 10 s age limit and against its 5 s skew limit.
The archived v2 mark stream agreed: 15 index changes in 75 s on BTC and TRUMP, 13 on ETH, SOL and XRP (Probed).

## 5. REST book snapshot

| Item | Value | Evidence |
| --- | --- | --- |
| Call | `GET /v1/book/{symbol}?limit_bids=N&limit_asks=N` | [R1] |
| Depth | Default 50 per side, 0 returns the full side | [R1] |
| Shape | `{bids: [{price, amount, timestamp}], asks: [...]}`, strings | [R1], Probed |
| `timestamp` | "DO NOT USE", a dummy value | [R1] |
| Level order | Bids strictly descending, asks strictly ascending, on BTC and TRUMP full books | Probed |
| Full book size | BTC 17 bids and 16 asks, 2,065 bytes, TRUMP 7 bids and 13 asks, 1,235 bytes. Second pass: BTC 17 and 17, TRUMP 6 and 13 | Probed |
| Far levels | BTC bid 1.0 for 1.0 BTC and ask 140000.0 for 0.01 BTC, in both runs | Probed |
| Caching | No `cache-control` or `age` header, three reads 0.6 s apart returned current books | Probed |
| Unknown symbol | 400 `{"result":"error","reason":"Bad Request","message":"Supplied value 'NOSUCHPERP' is not a valid symbol"}` | Probed |

The current socket's `depth` request method is a second snapshot source, see [`websocket.md`](./websocket.md) section 2.

## 6. Rate limits and errors

| Item | Value | Evidence |
| --- | --- | --- |
| Public limit | 120 requests per minute, with 1 request per second recommended | [R4] |
| Burst | Five more requests are queued, beyond that a 429 is returned until the rate falls | [R4] |
| Scope of the limit | "a group of endpoints", and which endpoints share a group is Not publicly specified | [R4] |
| Status on limit | 429, body `{"result":"error","reason":"Too Many Requests","message":"Too Many Requests"}` | [R1], [R6] |
| `Retry-After` | Not publicly specified, not observed because the probe stayed under the limit | Probed |
| Other statuses | 400 malformed or market not open, 404 unknown endpoint, 500, 502, 503 maintenance | [R6] |
| Error body | `{"result":"error","reason":..., "message":...}` | [R6], Probed |

Errors as they came back (Probed).

| Request | Status | Body |
| --- | --- | --- |
| `/v1/riskstats/nosuchperp` | 400 | `{"result":"error","reason":"InvalidSymbol","message":"Received unsupported symbol 'nosuchperp'"}` |
| `/v1/riskstats/btcusd` | 400 | `InvalidSymbol`, the call is perpetual only |
| `/v1/fundingamount/nosuchperp` | 404 | empty body |
| `/v1/fundingamount/btcusd` | 404 | empty body |
| `/v1/symbols/details/nosuchperp` | 400 | `InvalidSymbol` |
| `/v1/feepromos` | 404 | `EndpointNotFound`, removed from the documentation 2026-09-10 |

The second pass returned the same status and body on every row.

The 404 with an empty body on an unknown funding symbol matters.
`AnchorPoller.getJson` throws on it, at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 230 to 237, so a delisted symbol inside a `Promise.all` round would fail every round.

## 7. Server time

REST has no time call, and the `date` header has one second resolution.
The current socket's `time` method answered `{"serverTime":1789456742225}` in a 67 ms round trip, 0.5 ms from the local midpoint (Probed).

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

- Symbols: one of each twin, so the seven GUSD perpetuals or the six USDC ones, keyed by `market.id`.
- `riskstats` for index and mark, one symbol per request, spaced so that all tracked symbols fit under 120 requests per minute with margin, which is about 7 s per round for seven symbols at one request per second.
- `fundingamount` once a minute per symbol, about 20 s past the minute, because the estimate changes once a minute and the call can take 3.8 s.
  Drop its columns for the first 80 s of the hour, see section 4.4.
- Row mapping as in section 3.2, with `fundingRate = estimatedFundingAmount / mark`.
- `requestTimeoutMs` of at least 5,000 for the funding call.
- A missing or 404 funding reply for one symbol should drop that symbol for the round, not fail the round.
- The stamp should be the arrival of the `riskstats` reply, since the funding fields move once a minute.
- Skip `r`, `funding_rate` and the current socket's `i`.

The one-second, one-request-for-every-perpetual shape of [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) does not fit Gemini, because there is no bulk call, and a one second round of even the 6 USDC `riskstats` is three times the public limit, see section 3.1.
Two named changes would fit it.
One is a per-symbol round-robin poller that keeps each symbol's own arrival stamp, which leaves most legs 5 to 7 s old and fights the 5 s skew limit.
The other is a socket anchor on the archived v2 `mark_price` and `funding_amount` feeds, re-stamped on every frame and refreshed by `riskstats` when a symbol has sent no mark frame for a few seconds, because v2 omits frames when only the index moves.
Either needs a design decision, and the possible mark clamp in section 4.2 should be settled first.

## 9. Source ledger

Sources F3, F7, F8, F10 and F13 are the fee profile's S3, S7, S8, S10 and S13, listed in [`fees.md`](./fees.md) section 10.
Source W1 and W7 are listed in [`websocket.md`](./websocket.md) section 9.

| Id | Title | URL | Retrieved | Entity or region | Sections supported |
| --- | --- | --- | --- | --- | --- |
| R1 | REST OpenAPI specification 1.0.0 | https://developer.gemini.com/specs/openapi/rest.yaml | 2026-09-15 | Gemini API | 1, 2, 3, 4, 5, 6 |
| R2 | Get Risk Stats | https://developer.gemini.com/trading/rest-api/derivatives/get-risk-stats.md | 2026-09-15 | Gemini API, perpetuals | 3 |
| R3 | Get Funding Amount | https://developer.gemini.com/trading/rest-api/derivatives/get-funding-amount.md | 2026-09-15 | Gemini API, perpetuals | 3 |
| R4 | Rate Limits | https://developer.gemini.com/rate-limit.md | 2026-09-15 | Gemini API | 3, 6, 8 |
| R5 | What is the Mark Price and why is it important? (updated 2026-01-21) | https://support.gemini.com/hc/en-us/articles/12086831169819-What-is-the-Mark-Price-and-why-is-it-important | 2026-09-15 | Perpetuals | 4 |
| R6 | Error Codes | https://developer.gemini.com/error-codes.md | 2026-09-15 | Gemini API | 6 |
| R7 | Get Next Funding Timestamp | https://developer.gemini.com/trading/rest-api/derivatives/get-next-funding-timestamp.md | 2026-09-15 | Gemini API, perpetuals | 3 |
| C1 | CCXT gemini class 4.5.68 | `server/node_modules/ccxt/js/src/gemini.js` lines 228, 296, 306, 420, 708 to 713, 766 to 823 | 2026-09-15 | CCXT | 2 |
| C2 | CCXT base Exchange 4.5.68 | `server/node_modules/ccxt/js/src/base/Exchange.js` lines 1186 and 3735 | 2026-09-15 | CCXT | 2 |
