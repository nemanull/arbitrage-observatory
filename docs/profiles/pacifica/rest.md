# Pacifica REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:17 to 22:31 UTC and in the second pass from 22:37 to 22:40 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the public REST API of Pacifica (CCXT id `pacifica`) that a catalog, an anchor poller and a book check would use, and the decentralised layer behind it.
Every call here is an unauthenticated `GET` under `https://api.pacifica.fi/api/v1`, and nothing here signs, holds a wallet or reads an account.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/pacifica/rest-probe.py) or [`fees-probe.py`](../../../scripts/probes/venues/pacifica/fees-probe.py), run with `uv run` from the repository root, and the runs are listed in section 10.
Where the documentation and the wire disagree, both are written.
Fees and who may trade are in [`fees.md`](./fees.md), and the socket is in [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 UTC | edge |
|---|---|---|---|
| `api.pacifica.fi` | REST API, S1 | CNAME `do5jt23sqak4.cloudfront.net`, four A records `18.238.238.123`, `18.238.238.31`, `18.238.238.47` and `18.238.238.64`, and eight AAAA records, P1 and P2 | CloudFront: `via: 1.1 ….cloudfront.net (CloudFront)`, `x-amz-cf-pop: SEA900-P5`, P1 and P2 |

The edge is a CloudFront point of presence in Seattle, and the origin behind it is not visible from here.
Every public call answered, and no reply was a refusal or a geoblock.

Latency, one Python process per run, with a kept connection after the first request, P1 and P2.

| call | first request ms, with TCP and TLS | kept connection ms | reply bytes | CloudFront |
|---|---:|---|---:|---|
| `/info` | 174 and 169 | five reads: min 13 to 14, median 14 to 17, max 17 to 28 | 27,442 to 27,445 | `cache-control: public, max-age=300`, a hit 1 to 2 s old after the first read |
| `/info/prices` | 162 and 223 | five reads: min 104 to 109, median 104 to 114, max 108 to 409. 45 polls: min 106 and 104, median 110 and 111, p90 119 and 119, max 405 and 421 | 17,755 to 17,812 | no `cache-control`, a miss on every read |
| `/book?symbol=BTC` | 164 and 156 | five reads: min 105 to 113, median 108 to 115, max 116 to 121 | 766 to 769 | no `cache-control`, a miss on every read |
| `/info/fees` | 154, and 42 when the first read was a cache hit in P2 | five reads: min 11 to 12, median 13, max 14 to 21 | 576 | `cache-control: public, max-age=3600`, a hit up to 1,236 s old |

No reply was compressed.
No reply took over 2 s, so the reader's 5 s skew and 10 s age limits at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 4 and 5 are not at risk from the round trip.

## 2. Catalog

### The instruments call

`GET /api/v1/info` returns `{success, data, error, code}`, where `data` lists every market oldest first, S2.

| item | value, P1 and P2 alike |
|---|---|
| rows | 78: 77 `perpetual` and 1 `spot`, `SOL-USDC` |
| fields on every row | `symbol`, `base_asset`, `instrument_type`, `tick_size`, `min_tick`, `max_tick`, `lot_size`, `max_leverage`, `isolated_only`, `min_order_size`, `max_order_size`, `funding_rate`, `next_funding_rate`, `created_at` and `execution_modes` |
| `execution_modes` | `["orderbook"]` on 55, and `["orderbook", "rfq"]` on 23, which are the 20 equity, FX, index, ETF and commodity markets of the docs' table, S3, plus `MU`, `SNDK` and `DRAM` |
| status field | none. CCXT sets `active` to the literal `true` because "there is no non-active markets comes from endpoint market info", at `pacifica.js` line 708 |
| `symbol` against `base_asset` | equal on all 77 perpetuals. Only `SOL-USDC` differs, with base `SOL` |
| lowercase names | `kBONK`, `kPEPE` and `kSHIB`, priced per 1,000 tokens. Symbols are case-sensitive, S4 |
| other names | `2Z` and `SP500` hold digits. No name is non-ASCII, and none is listed twice |
| `isolated_only` | false on every row |
| `funding_rate` equal to `next_funding_rate` | 64 of 77 in P1 and 62 in P2 |
| `max_leverage` | 3 on 8, 5 on 10, 10 on 49, 20 on 6 and 50 on 4 |
| `min_order_size` | 10 USD on all 77 |
| newest listings | `SNDK` and `DRAM` on 2026-07-30, `PONS` on 2026-09-01, `USELESS` on 2026-09-09 and `META` on 2026-09-22 |

The docs say the catalog is linear perpetuals with "1 unit of underlying spot asset" per contract, S5, and USDC margin, S3.
Docs counts lag the catalog: the about page says "65+ perpetual pairs", S12, the overview "Over thirty-five", S13, and the market table, "last generated 2026-07-16", lists 68 perpetuals, S3.
Nine perpetuals are newer than that table, `VVV`, `KAITO`, `kSHIB`, `MU`, `SNDK`, `DRAM`, `PONS`, `USELESS` and `META`, so their oracle baskets are not published.
By the table and those nine, the 77 split into 53 crypto names and 24 equity, FX, index, ETF and commodity markets.
That split reads `META`, at an oracle of 742.227078 USD, and `MU`, `SNDK` and `DRAM`, which take RFQ like the 20 documented ones, as equities, P2.

### How CCXT 4.5.68 maps it

| item | value | evidence in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pacifica.js` |
|---|---|---|
| call | `GET /api/v1/info`, one call | `fetchMarkets` at lines 576 to 619 |
| `market.id` | the catalog `symbol`: `BTC`, `kPEPE`, `SOL-USDC` | lines 665 and 710 |
| `base` | `base_asset` through `safeCurrencyCode`, which uppercases `kPEPE` to `KPEPE` | lines 666 and 696 |
| `quote`, `settle` | the literal `USDC` for every perpetual | lines 670 and 686 |
| `type` | `swap` unless `instrument_type` is `spot` | lines 667 to 669 and 687 |
| `linear`, `contractSize` | the literal `true` and `1` | lines 688 and 690 |
| `active` | the literal `true` | line 708 |
| `taker` | `fees.swap.taker`, `0.0004` | lines 237 and 703 to 704, see [`fees.md`](./fees.md) section 8 |
| pacing | `rateLimit` 600 ms, "100 credits per minute without an API Config Key" | line 27 |

Probed through CCXT without credentials, P1 and P2 of `fees-probe.py`:

| result | value |
|---|---|
| markets | 78, 77 swap and 1 spot, loaded in 214 ms in P1 and 161 ms in P2 |
| active linear swaps quoted in USDT, USDC or USD | 77, all `USDC` quote and settle |
| `market.id` equal to `info.symbol` | 77 of 77 |
| `contractSize`, `linear`, `taker` | 1, true and 0.0004 on 77 of 77 |
| `base` different from `id` | `kBONK` as `KBONK`, `kPEPE` as `KPEPE`, `kSHIB` as `KSHIB` |

### What the catalog needs

- `rawMarketId` is `market.id`, the catalog `symbol`, because the socket and the anchor key every market by that same spelling, see [`websocket.md`](./websocket.md) section 4.
- The loader keeps `instrument_type` `perpetual` and drops `SOL-USDC`.
- `kPEPE`, `kBONK` and `kSHIB` are 1,000 tokens per unit, in price and in size, S3: `kSHIB` read an oracle of 0.005227, `kBONK` 0.00325 and `kPEPE` 0.003986 at 22:40, P2.
  CCXT's `KPEPE` base clusters with nothing, so the loader should name the base `PEPE`, `BONK` and `SHIB` with a `price_scale` of 0.001, as [`hyperliquid/markets.rs`](../../../server/src/venues/hyperliquid/markets.rs) lines 48 to 61 do, and record that as a CCXT difference.
  Corrected on 2026-10-12 from "a price scale of 1,000", because `price_scale` multiplies a book price into the price of one token.
  That day the `live_identity` test found `kPEPE`, `kBONK` and `kSHIB` times 0.001 within 2 percent of the per-token PEPE, BONK and SHIB of okx, gate and MEXC.
- Book sizes are base units, so the contract size is 1, S5, and the `BTC` book carried sizes such as `0.13398`, section 5.
- Tickers for the identity check of decision 15 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md): `META` reads as Meta Platforms at about 742 USD, `BP` is Backpack's token with a Backpack-only oracle, and `LIT`, `MEGA`, `CHIP`, `PONS`, `USELESS`, `MU`, `SNDK`, `DRAM`, `SPCX`, `CL` and `COPPER` are short names that another venue may give another asset.
  The listings mode found `BP`, `PLATINUM` and `SP500` under those names on none of Binance USD-M, Bybit, OKX and Hyperliquid's first dex, `EURUSD` and `USDJPY` on Bybit alone, and 45 of the 77 on all four, P1 and P2.
  Corrected on 2026-10-12, the listings mode had also put `COPPER` and `NATGAS` on none of the four, while Binance USD-M lists both as `TRADIFI_PERPETUAL` contracts that the mode missed.
  That day none of Binance, Bybit, OKX, gate and MEXC listed `PLATINUM` or `SP500` under those names, so the `live_identity` test could compare neither.
  The same run compared the other 75, and 74 sat within 2 percent of the reference median, the watched tickers above included.
  `BP` sat 2.7 to 3.1 percent above MEXC's `BP_USDT` over two runs because its own book was 2.8 percent wide, while its oracle equalled Backpack's `BP_USDC` last trade at 1.109 and MEXC's mark read 1.087 to 1.092, so both read as Backpack's token.
- Pacifica alone lists markets, and every one is its own, see section 9, so no market needs a builder filter.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/info/prices`, S6 | `oracle` | `mark` | `funding` and `next_funding`, see below | absent, 1 h by S7 | absent, the next whole UTC hour | 17.8 KB, 78 rows | 45 polls: median 110 and 111 ms, max 405 and 421 ms, P1 and P2 |
| `GET /api/v1/info` | none | none | `funding_rate` and `next_funding_rate` | absent | absent | 27.4 KB, cached up to 300 s at CloudFront | 13 to 28 ms when cached |

Each `prices` row carries `symbol`, `oracle`, `mark`, `mid`, `funding`, `next_funding`, `open_interest`, `volume_24h`, `yesterday_price` and `timestamp`, on 78 of 78 rows, P1.
No row had a null or zero `oracle`, `mark` or `mid`, P1 and P2.
The spot row `SOL-USDC` carries an `oracle` equal to its `mark` and a `funding` of `0`, so a poller skips it.
Every row of one reply carried the same `timestamp` on 42 of 45 polls in P1, with two values on the other 3, and on 45 of 45 in P2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTC` or `kPEPE` | as is |
| `index` | `oracle` | decimal string | parse as f64 |
| `mark` | `mark` | decimal string, never 0 on a live row | parse as f64 |
| `funding_rate` | `funding`, read as the rate of the coming settlement, see section 4 | a fraction per hour: `"0.0000125"` is 0.00125 % | parse as f64 |
| `funding_interval_hours` | none on the wire | the constant 1, S7 and S5 | 1 |
| `next_funding_at` | none on the wire | the next whole UTC hour | `(ts / 3_600_000 + 1) * 3_600_000` in integer ms |

The catalog's `funding_rate` equalled `prices` `funding` on 77 of 77 perpetuals, while its `next_funding_rate` equalled `next_funding` on 68 of 77, because the catalog is cached for up to 300 s, P1 and P2.
So the anchor reads `prices` and never `info`.

## 4. Anchor semantics

### Index, the oracle

The oracle "is updated every 3 seconds and calculated as a weighted average of USDT denominated prices from major exchanges", with weights Binance 2, OKX 1, Bybit 1 and Hyperliquid 1, S8.
The market table gives each market's own composition instead, S3.

| composition, S3 | markets |
|---|---|
| Binance spot 40 %, Binance futures index 20 %, OKX spot 20 %, Bybit spot 20 % | most crypto names, among them `BTC`, `ETH`, `SOL`, `kPEPE` and `kBONK` |
| Binance futures index, OKX spot and Bybit spot at a third each | `HYPE`, `LIT` |
| Binance spot 50 %, Binance futures index 25 %, OKX spot 25 % | `PAXG`, `TAO`, `ZEC` |
| Binance futures index and OKX spot at half each | `MON` |
| Binance futures index 100 % | `FARTCOIN`, `XMR`, `PIPPIN` |
| Backpack spot 100 % | `BP` |
| trade.xyz index 71 %, Lighter index 14 %, Bitget index 14 % | `CRCL`, `GOOGL`, `HOOD`, `NVDA`, `PLTR`, `TSLA`, `CL`, `XAG`, `XAU` |
| trade.xyz index 100 % | `PLATINUM` |
| other mixes of Binance futures index, trade.xyz, Lighter and Bitget | `MSTR`, `SAMSUNG`, `SKHYNIX`, `SPCX`, `SP500`, `URNM`, `EURUSD`, `USDJPY`, `COPPER`, `NATGAS` |
| not published | the nine perpetuals listed after 2026-07-16, section 2 |

The table names Hyperliquid in no crypto composition, while S8 weighs it 1 of 5, so the docs disagree with each other.
"A stale venue drops out and remaining weights renormalize", and the USDT and USDC source prices "enter the oracle as-is", with no conversion between them, S3.
No API call returns a basket, so the composition is the docs table alone.
A pre-market that no major venue lists uses "Pacifica's mark price instead of external sources", with an EMA and a band of ±30 % of the mark, S9.
That is the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), and no field marks which market is a pre-market today.
Every crypto name was listed on at least one of Binance USD-M, Bybit, OKX and Hyperliquid except `BP`, whose oracle is Backpack spot, P1 and P2.

On the wire the whole `prices` snapshot is republished every 3 s: the `BTC` `timestamp` stepped by 2,997 to 3,005 ms once every three polls, P1 and P2.
The oracle changed on a median of 14 of 44 transitions, which is every republish, while `kPEPE` held one oracle for 26 and 15 transitions and `BP` for 37 and 44, P1 and P2.

### Mark

The mark is "the median value of" the "Oracle (spot) price", "The median of best bid, best ask, and last trade on Pacifica" and the "Perpetual price from major exchanges", S8.
Input 3 is the perpetual marks of Binance, OKX, Bybit and Hyperliquid for crypto, or the RWA venues for other markets, S3.
No clamp on the mark is published, apart from the ±30 % band on pre-markets, S9.
The contract table calls the oracle the "Price used for liquidation & PnL", S5, while S8 says the mark is used for liquidations, margin and unrealized PnL.

| check | P1 | P2 |
|---|---|---|
| `mark` against `oracle`, one read of 77 perpetuals | median 486 ppm, p90 1,145, max 3,106 on `NATGAS` at 22:17, and median 224, p90 963, max 2,574 on `NATGAS` at 22:31 | median 334 ppm, p90 957, max 2,545 on `NATGAS` at 22:37 |
| `mark` equal to `oracle` | 24 of 77 at 22:31 | 19 of 77 |
| `mark` equal to `mid` | 5 of 77 at 22:31 | 4 of 77 |
| `mark` changes over 44 transitions | median 12, max 15, and 6 markets never changed | median 8.5, max 15, and 8 markets never changed |

So the mark sits on the oracle when the oracle is the middle input, and input 3 means a route between Pacifica and Binance, OKX, Bybit or Hyperliquid compares a book against a mark partly built from the other leg's venue.

Two properties matter to the open guard at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) line 6, which refuses an index or mark that moved more than 1,000 ppm in one poll.
A 1 s poll sees a whole 3 s move in one step, and 16 and 13 of 6,864 poll-to-poll moves of the oracle or the mark exceeded 1,000 ppm in P1 and P2, the largest 1,664 ppm on the `MEGA` oracle and 1,615 ppm on the `ZK` oracle.
One book tick is a median of 56 ppm of the mid, over 100 ppm on 25 markets, and over 1,000 ppm on `STRK` (1,142 and 1,151), `XPL` (1,211 and 1,212), `CHIP` (1,715), `WLFI` (1,756) and `2Z` (2,786 and 2,774), P1 and P2, so a mark that sits on the book of those five moves past the guard in one tick.

### Funding

S7 is the formula of record, and [`fees.md`](./fees.md) section 6 treats funding as a cost.

```text
funding_rate = (premium_index + clamp(interest_rate - premium_index, -0.05%, 0.05%))/8
impact_price = max(impact_bid_price - oracle_price, 0) - max(oracle_price - impact_ask_price, 0)
```

S7 writes `premium_index = impact_price / oracle_price - 1`, which reads as a misprint, since `impact_price` there is a difference, so the probe used the difference over the oracle.
The rate is sampled every 5 s, shown as a TWAP, averaged at the end of each hour and capped at ±4 % per hour, S7.

`GET /api/v1/funding_rate/history?symbol=…` returns rows newest first with `oracle_price`, `bid_impact_price`, `ask_impact_price`, `funding_rate`, `next_funding_rate` and `created_at`, up to 4,000 a call with a cursor, S10.

| check | P1, and P2 alike unless stated |
|---|---|
| row spacing | 3,599,999 to 3,600,026 ms on `BTC`, `ETH`, `kPEPE` and `XAU` |
| row instant | 2,088 to 2,115 ms past each whole UTC hour |
| `BTC` history | 4,000 rows from 2026-04-28 23:00 to 2026-10-12 22:00, with 8 hours missing, among them 2026-10-04 00:00 and 2026-09-09 00:00 |
| a row's `next_funding_rate` equal to the next row's `funding_rate` | 29 of 29 on each of the four symbols, and 3,995 of 3,999 on `BTC` in P2 |
| the row's `funding_rate` from its own oracle and impact prices | 27, 16, 29 and 5 of 30 on `BTC`, `ETH`, `kPEPE` and `XAU`, mostly where the rate sits on the 0.0000125 floor, which fits a TWAP of 5 s samples rather than one sample |
| `prices` `funding` against the newest history row | equal to its `next_funding_rate` on `XAU`, where the three values differed: history `funding_rate` 0.0000109, history `next_funding_rate` and `prices` `funding` -0.00004446, and `prices` `next_funding` 0.00000787 at 22:17 and 0.00000476 at 22:37 |
| `prices` `funding` over 44 transitions | never changed, on all 78 rows, in both polls |
| `prices` `next_funding` over 44 transitions | changed on up to 9, `XAU` on 8 and 5, and stayed put on 69 and 68 rows |

The documents disagree on what the two `prices` fields are.
S6 calls `funding` the rate "paid in the past funding epoch (hour)" and `next_funding` the "estimated funding rate to be paid in the next funding epoch (hour)".
S10 calls a history row's `funding_rate` the "Last settled funding rate" and its `next_funding_rate` the "Predicted funding rate for next settlement".
On the wire the value a history row calls next became the next row's settled value 3,995 times in 3,999, so it is not a prediction but a rate fixed an hour ahead, and `prices` `funding` carries that fixed value through the hour.
CCXT 4.5.68 reads it the same way: `funding` is the rate for the next whole hour, at `pacifica.js` lines 1130 and 1135, and a history row's `funding_rate` is the rate at its `created_at`, at line 2077.
Under that reading `funding` is the rate charged at the next whole hour, computed from the hour before, and `next_funding` is the running TWAP for the settlement after it.
Under S6's reading `funding` is the rate charged at the last whole hour.
Which rate an account is charged was not captured, because that needs an account's funding history and waiting for a settlement, both out of scope.

## 5. REST book snapshot

`GET /api/v1/book?symbol=BTC&agg_level=1`, S11.

| item | documented, S11 | probed, P1 and P2 |
|---|---|---|
| depth | "up to 10 levels" per side | 10 and 10 on `BTC`, `kPEPE`, `XAU` and `SOL-USDC` |
| order | | bids descending and asks ascending on every read |
| level | `{p, a, n}`, `n` the number of orders | strings for `p` and `a`, integer `n` |
| keys | `s`, `l`, `t` | `s`, `l` and `t` only. No `li` and no `last_order_id`, which S20 documents on the REST snapshots of positions, orders and trades, not on the book |
| timestamp | "Response timestamp in milliseconds" | `t` trailed local arrival by 50 to 82 ms |
| caching | | three `BTC` reads 0.3 s apart had `t` 413 to 670 ms apart and changed levels, so no edge cache |
| `agg_level` | 1, 10, 100, 1,000 or 10,000 since 2026-01-24, S17 | 10 accepted, and 7 answered 200 with a book, where the socket refuses 7 |
| unknown symbol | | HTTP 400 `{"success":false,"data":null,"error":"Book not found: NOPE","code":400,"error_id":"unspecified"}`, and the same for `btc` |

The REST book holds the same 10 levels as the socket, so the socket is the book source and REST is only a check.

## 6. Rate limits and errors

| item | documented, S14 | probed |
|---|---|---|
| budget | 100 credits per rolling 60 s for an unidentified IP, 300 with an API Config Key, and 300 to 30,000 by fee tier | `ratelimit-policy: "credits";q=1000;w=60` on every reply, which is 100 credits in the header's units of a tenth, P1 |
| cost | 1 credit for a standard request, 0.5 for a cancel, 3 to 12 for a heavy GET | the first reads of `/info`, `/info/prices`, `/book` and `/info/fees` carried `r=990`, `r=980`, `r=960` and `r=950`, P1 |
| remaining | `ratelimit: "credits";r=…;t=…` with `t` the seconds until refresh | over 45 polls a second apart the header read 62 credits at the first poll, 56 at the lowest and 94 at the last, P2, which fits 1 credit a poll in a window that refills every 60 s |
| cached replies | | `/info` and `/info/fees` come from CloudFront and repeat the header of the cached origin reply, so their `ratelimit` value is stale |
| at the limit | HTTP 429 | not reached |
| `Retry-After` | not documented | absent on every reply and error |

| request | status | content type | body |
|---|---:|---|---|
| `/book?symbol=NOPE` | 400 | `application/json` | `{"success":false,"data":null,"error":"Book not found: NOPE","code":400,"error_id":"unspecified"}` |
| `/book` without `symbol` | 400 | `application/json` | `error` "`symbol`: This field is required.", `error_id` `malformed_request`, with a `details` object |
| `/funding_rate/history?symbol=NOPE` | 200 | `application/json` | `{"success":true,"data":[],"has_more":false}` |
| `/nope` | 404 | `application/json` | `{"success":false,"data":null,"error":"Not found","code":404,"error_id":"unspecified"}` |
| `POST /info/prices` | 404 | `application/json` | the same `Not found` body |
| `GET /info/prices` with a body `{}` | 403 | `text/html` | CloudFront's "The request could not be satisfied" page, as S15 documents |

These held in P1 and P2.
A poller that sends a body on a GET is refused with a 403 that looks like a rate limit to [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 21, which pauses on 403, 418 and 429, so the request must carry no body.

## 7. Server time and clock offset

There is no time call.
On the `BTC` book, local midpoint time minus `t` was -91 ms on a 287 ms round trip and -4 ms on round trips of 113 and 122 ms in P1, and 12, -2 and -3 ms on round trips of 143, 112 and 112 ms in P2.
So the venue's clock and this host's agree within the round trip.
The `prices` `timestamp` sits on a 3 s grid, and a reading arrived 362 to 2,663 ms after it, median 1,367 ms, over 45 polls in P1, and 104 to 2,423 ms, median 1,115 ms, in P2.
The engine stamps an anchor reading on arrival, so a Pacifica reading is older than its stamp by up to about 2.7 s at a 1 s poll.

## 8. Recommended poller shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| source | `GET https://api.pacifica.fi/api/v1/info/prices` | one call carries index, mark and funding for every market, uncached |
| interval | 1,000 ms, the default of `poll_every` at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 57 | the snapshot republishes every 3 s, so a 1 s poll reads each one within about a second, and it costs 60 of the 100 credits an unidentified IP gets per 60 s, section 6. 2 s halves the cost if a 429 ever appears |
| row mapping | section 3, keyed by `symbol` | the key equals `rawMarketId` |
| funding rate | `funding`, the rate fixed for the next whole hour, and log the doc conflict of section 4 once | the history chain and CCXT read it that way, and S6 reads it as the last paid rate |
| interval and next settlement | `funding_interval_hours` 1, and `next_funding_at` the next whole UTC hour after the arrival stamp | neither is on the wire, and history rows land 2.1 s after each hour |
| skip | `SOL-USDC` and any symbol not in the loaded catalog | spot has no funding |
| leave out of the anchor rows | none today. A market whose oracle becomes its own mark, a pre-market under S9, would be left out as decision 4 of the waves design says | no pre-market was found, section 4 |
| flag | `BP`, `PLATINUM`, `FARTCOIN`, `XMR` and `PIPPIN` have a single-source oracle, and `STRK`, `XPL`, `CHIP`, `WLFI` and `2Z` have a tick over 1,000 ppm | section 4 |
| request | a plain GET with no body and no `Content-Type` | a GET with a body gets a CloudFront 403 |
| rate limit pause | the default 60 s at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 20 | 429 is documented with no `Retry-After` |
| socket alternative | the `prices` channel, written into `SocketAnchors` | it pushes the same rows every 3 s at about 57 ms of age and costs no credits, see [`websocket.md`](./websocket.md) section 2 |

## 9. Decentralised layer

### Chain, sequencer and time stamps

Pacifica runs its own off-chain matching engine, and custody sits on Solana, S16.
Deposits and withdrawals go through Solana bridge programs, the hot wallet is "managed by the matching engine", and the cold vault is a Squads multisig, S16.
The documented addresses are the USDC bridge `72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa`, the SOL bridge `9sSr35zwnFTuv2kZ86i55sR9dqQLTG663homexrLYgYu`, the USDC cold vault `5kwCMKjE3Krvs7cHfcQ9kBkGyPQphd3oJ4KnsXcpMoVc` and the SOL cold vault `8nFeyzTFhUXp11raJkSSvZWn9GXDjcrGq8LuzP9aKtg8`, S16.
The same page names "the AWS infrastructure" among the engine's systems, S16.
No block or slot stamps a book or an anchor: the engine stamps every book `t`, `bbo` `t`, `prices` `timestamp` and `li` in its own Unix ms and event ids, see [`websocket.md`](./websocket.md) section 4.
The `prices` snapshot is stamped on a 3 s grid, and a book's `t` is the time of its last change.
So there is no chain-side copy of the book to read instead of the API.
Takers wait through a speed bump of about 200 ms on market, GTC and IOC orders, S17.

### Who may use it and from where

Trading is closed to the Restricted Jurisdictions, the United States, Cuba, Crimea, Iran, Afghanistan, Syria and North Korea, and trading functionality is blocked by IP from them, S13.
A Solana wallet is the account, see [`fees.md`](./fees.md) section 1, and no KYC step appears in the documentation read here.
CCXT maps HTTP 403 to "Forbidden: restricted region", at `pacifica.js` line 375.
From the Canadian exit every public REST call and socket answered, and no call met a region check, P1, P2 and [`websocket.md`](./websocket.md).
Deposits are capped at 500,000 USD of account equity during the closed beta, see [`fees.md`](./fees.md) section 1.

### Oracle

The oracle is Pacifica's own weighted average of other venues' prices, recomputed every 3 s, with the per-market compositions of section 4.
Its sources are Binance spot and futures index, OKX spot, Bybit spot, Backpack spot, and the trade.xyz, Lighter and Bitget indices for RWA markets, S3, plus Hyperliquid by S8.
trade.xyz carries the largest weight on the RWA markets, 71 % to 100 %, and S3 lists it as a source apart from Hyperliquid.
Whether its index is the oracle of Hyperliquid's `xyz` builder dex, which lists the same kind of names in [`../hyperliquid/rest.md`](../hyperliquid/rest.md) section 2, was not verified.
The mark adds the perpetual marks of Binance, OKX, Bybit and Hyperliquid for crypto and of the RWA venues for the rest, S3.
No oracle field or call is on chain, and none is public beyond `prices`.

### Who lists markets

Pacifica lists every market itself.
The catalog has no deployer, builder or dex field, and no permissionless listing appears in the documentation.
Users deploy vaults, called lakes in the API, and builders attach fee codes to orders, but both trade Pacifica's own markets, S18 and [`fees.md`](./fees.md) section 5.
So a ticker names what Pacifica chose, and the risk is a name that means another asset elsewhere, section 2.

### Routing

Pacifica routes to no other venue, and its book is its own.
Its builder program lets third-party front ends send orders to Pacifica's book with a builder code, S18, and CCXT sends the code `CCXT`, see [`fees.md`](./fees.md) section 5.
No public list of those front ends exists, so which survey venues show Pacifica's book is Not publicly specified.
Its prices lean the other way: a Pacifica leg against Binance, OKX, Bybit, Hyperliquid, Lighter, Backpack or Bitget compares Pacifica's book with an oracle and a mark built partly from the other leg's venue.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | REST API | https://docs.pacifica.fi/api-documentation/api/rest-api | 2026-10-12 | Pacifica, API docs | base URL, section 1 |
| S2 | Get Market Info | https://docs.pacifica.fi/api-documentation/api/rest-api/markets/get-market-info | 2026-10-12 | Pacifica, API docs | catalog fields, section 2 |
| S3 | Market Specifications | https://docs.pacifica.fi/trading-on-pacifica/contract-specifications/market-specifications | 2026-10-12 | Pacifica, docs | per-market oracle composition, RWA list, `k` names, sections 2, 4 and 9 |
| S4 | Market Symbols | https://docs.pacifica.fi/api-documentation/api/market-symbols | 2026-10-12 | Pacifica, API docs | case-sensitive symbols, section 2 |
| S5 | Contract Specifications | https://docs.pacifica.fi/trading-on-pacifica/contract-specifications | 2026-10-12 | Pacifica, docs | contract unit, hourly funding, oracle as liquidation price, sections 2 to 4 |
| S6 | Get Prices | https://docs.pacifica.fi/api-documentation/api/rest-api/markets/get-prices | 2026-10-12 | Pacifica, API docs | `prices` fields and their meaning, sections 3 and 4 |
| S7 | Funding Rates | https://docs.pacifica.fi/trading-on-pacifica/funding-rates | 2026-10-12 | Pacifica, docs | funding formula, sampling, cap, interval, sections 3 and 4 |
| S8 | Oracle Price & Mark Price | https://docs.pacifica.fi/trading-on-pacifica/contract-specifications/oracle-price-and-mark-price | 2026-10-12 | Pacifica, docs | oracle weights and cadence, mark formula, sections 4 and 9 |
| S9 | Pre-Markets | https://docs.pacifica.fi/trading-on-pacifica/contract-specifications/pre-markets | 2026-10-12 | Pacifica, docs | self-referenced oracle and ±30 % band, sections 4 and 8 |
| S10 | Get Historical Funding | https://docs.pacifica.fi/api-documentation/api/rest-api/markets/get-historical-funding | 2026-10-12 | Pacifica, API docs | history fields and limits, section 4 |
| S11 | Get Orderbook | https://docs.pacifica.fi/api-documentation/api/rest-api/markets/get-orderbook | 2026-10-12 | Pacifica, API docs | REST book, section 5 |
| S12 | About Us | https://docs.pacifica.fi/pacifica/readme | 2026-10-12 | Pacifica, docs | market count, section 2 |
| S13 | Overview | https://docs.pacifica.fi/trading-on-pacifica/overview | 2026-10-12 | Pacifica, docs | market count, Restricted Jurisdictions, sections 2 and 9 |
| S14 | Rate Limits | https://docs.pacifica.fi/api-documentation/api/rate-limits | 2026-10-12 | Pacifica, API docs | credits, costs, headers, 429, section 6 |
| S15 | 403 CloudFront | https://docs.pacifica.fi/api-documentation/api/api-faq/403-cloudfront | 2026-10-12 | Pacifica, API docs | GET with a body refused, section 6 |
| S16 | Fund Security | https://docs.pacifica.fi/trading-on-pacifica/fund-security | 2026-10-12 | Pacifica, docs | engine, Solana bridge, cold vault, section 9 |
| S17 | Changelog | https://docs.pacifica.fi/api-documentation/changelog | 2026-10-12 | Pacifica, API docs | `agg_level` values of 2026-01-24 and the 200 ms taker speed bump of 2025-11-12, sections 5 and 9 |
| S18 | Builder Program | https://docs.pacifica.fi/programs/builder-program | 2026-10-12 | Pacifica, docs | builder codes, section 9 |
| S20 | Last ID | https://docs.pacifica.fi/api-documentation/api/last-id | 2026-10-12 | Pacifica, API docs | where `li` and `last_order_id` appear, section 5 |
| S19 | CCXT 4.5.68 `pacifica.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pacifica.js` | 2026-10-12 | CCXT | catalog mapping, funding mapping, error map, sections 2, 4 and 9 |
| P1 | `rest-probe.py` modes `host` and `catalog` at 22:17, `anchor`, `funding`, `book` and `errors` at 22:17 to 22:18, `poll` at 22:19 to 22:20, `listings` at 22:28 and `anchor` again at 22:31 UTC, and `fees-probe.py` at 22:27 UTC | [`rest-probe.py`](../../../scripts/probes/venues/pacifica/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 9 |
| P2 | `rest-probe.py` modes `host`, `catalog`, `anchor`, `funding`, `book`, `errors` and `listings` at 22:37, `poll` at 22:37 to 22:38 and `anchor` again at 22:40, and `fees-probe.py` at 22:38 UTC, the second pass | [`rest-probe.py`](../../../scripts/probes/venues/pacifica/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 9 |
