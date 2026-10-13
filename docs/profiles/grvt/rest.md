# GRVT REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:21 to 22:35 UTC for the first pass and from 22:43 to 22:52 UTC for the second, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public market data REST API of GRVT (CCXT id `grvt`) that a catalog, an anchor and a book check would use, and section 9 covers the decentralised layer.
Every call is `POST https://market-data.grvt.io/full/v1/<name>` with a JSON body, S1, and nothing here logs in, signs, or calls `edge.grvt.io` or `trades.grvt.io`.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/grvt/rest-probe.py), whose sweep stayed at a third of the published limit.
P1 is the first pass of each mode and P2 the second pass, listed in section 10.
Where the documentation and the wire disagree, both are written.
Fees are in [`fees.md`](./fees.md) and the socket in [`websocket.md`](./websocket.md).
Engine code is cited at commit `2dc36ee`.

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 | edge |
|---|---|---|---|
| `market-data.grvt.io` | REST and socket market data | `104.20.24.100`, `172.66.150.111`, `2606:4700:10::6814:1864`, `2606:4700:10::ac42:966f`, no CNAME, P1 and P2 | Cloudflare: `server: cloudflare`, `cf-ray` ending in `YVR` or `SEA`, `cf-cache-status: DYNAMIC`, P1 and P2 |
| `api-docs.grvt.io` | API documentation | | Cloudflare 403 "Sorry, you have been blocked" to httpx with its own or a browser user agent and to curl with its own, P1 and P2, but 200 to curl with a browser user agent, P2 |
| `help.grvt.io` | help center | | 200 to httpx and curl, P2 |

The overview page says "GRVT's services are hosted in AWS Tokyo (ap-northeast-1)", S1, behind a Cloudflare edge in Vancouver or Seattle from this exit.
The docs refusal follows the client, not the address, so it is a bot filter rather than a geoblock, and every market data call answered.
GRVT bars Canada and the United States from trading, see [`fees.md`](./fees.md) section 1.

| call | one request ms | repeated requests ms | reply bytes |
|---|---:|---|---:|
| `ticker` for `BTC_USDT_Perp`, a new connection | 349.8 and 152.6, with DNS and TLS | ten on a kept connection: min 105.7 and 107.5, median 110.6 and 117.8, max 351.7 and 179.5 | 772 to 773 |
| `ticker` sweep over 184 perpetuals at 8 a second | | median 110.7 and 109.2, p90 115.1 and 115.6, max 180.8 and 138.9 | 772 to about 900 |
| `all_instruments` with `{"is_active":true}` | 136.4 and 294.7 | | 86,812 of JSON |
| `all_instruments` with `{}`, as CCXT sends | 135.6 and 285.1 | | 91,558 of JSON |
| `book` depth 10 to 500 | 106.0 to 209.9 | | 1,090 to 16,690 |

Pairs of numbers are P1 and P2.
Replies arrive gzip encoded when the client asks, P1 and P2.
No reply took over 0.4 s, so the reader's limits of 5 s skew and 10 s age at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 4 and 5 are not at risk from this host.

## 2. Catalog

### The instruments call

| body | rows on 2026-10-12, P1 and P2 |
|---|---|
| `{}`, CCXT's call at `grvt.js` line 627 | 194: 184 `ACTIVE` and 10 `DELISTED`, all `PERPETUAL`, in both passes |
| `{"is_active":true}` | 184, all `ACTIVE` |
| `{"kinds":["STABLE_PERP"]}` | 0 |
| `{"kinds":["FUTURE","CALL","PUT"]}` | 0 |

`is_active` defaults to false and `kinds` to `PERPETUAL`, S1.
Each row carries `instrument`, `instrument_hash`, `base`, `quote`, `kind`, `venues`, `settlement_period`, `base_decimals`, `quote_decimals`, `tick_size`, `min_size`, `create_time`, `max_position_size`, `funding_interval_hours`, `adjusted_funding_rate_cap`, `adjusted_funding_rate_floor` and `min_notional`, S1.
The wire adds two undocumented fields, `asset_class` and `status`, P1 and P2.
The `DELISTED` rows are `AI16Z`, `BLESS`, `COAI`, `EDGE`, `IP`, `MNT`, `RESOLV`, `SPCX`, `TON` and `VINE`, P1 and P2.

| active perpetuals, P1 and P2 | count |
|---|---:|
| quoted and settled in USDT | 184 |
| `asset_class` `CRYPTO` | 78 |
| `asset_class` `EQUITY`, stocks, ETFs and pre-IPO names | 98 |
| `asset_class` `COMMODITY` | 8 |
| `venues` `["ORDERBOOK","RFQ"]` | 184 |
| `funding_interval_hours` 8, 4 and 1 | 124, 59 and 1 |
| a base listed twice | 0 |

Every name is `<base>_USDT_Perp` and agrees with its `base` and `quote` fields, P1 and P2.
`base_decimals` and `funding_interval_hours` arrive as JSON integers, and prices, sizes and caps as strings, P1 and P2.

### Thousand-coin names

`KBONK`, `KPEPE` and `KSHIB` quote 1,000 coins, P2.
Their marks read 0.003255999, 0.003986599 and 0.005233487 against Binance's `1000BONKUSDT`, `1000PEPEUSDT` and `1000SHIBUSDT` at 0.00325724, 0.00398620 and 0.00523543, within 381 ppm, P2 `binance` mode.
Their indexes matched Binance's as well, 0.003258379 against 0.00325838 on `KBONK`, P2.
The prefix is not a rule: `KAIA` is a crypto token, and `KORU`, `KSTR` and `KODEX200` are equities, P1 and P2.

### Names shared with other venues

180 of the 184 bases are also Binance USD-M perpetuals, and 170 are Bybit linear perpetuals, P2 `collisions` mode.
All 105 equity and commodity bases that Binance lists are its `TRADIFI_PERPETUAL` contracts, P2.
P1 counted only Binance's `PERPETUAL` contract type and found 75, all crypto.
GRVT's marks sat within 0.33 % of the references on every shared equity and commodity base except `OPENAI`, 1.28 % to 1.30 % from Bybit in three runs, and `ANTHROPIC`, which read 2,015.17 against Binance's 2,015.43 and Bybit's 2,063.12, a gap from Bybit of 2.32 % to 2.33 % in three runs, P1 and P2.
Both are pre-IPO perpetuals, which Binance marks `PREMARKET` with the subtype `Pre-IPO`, P2.
No base was more than 10 % away, the identity check's fail line in decision 15 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md).
The 4 bases neither lists are `KBONK`, `KPEPE` and `KSHIB`, which both list under their 1,000-coin names, and `SPACEX`, P2.

GRVT also copies Binance's funding terms.
180 of the 183 GRVT caps that `fundingInfo` covers equal Binance's `adjustedFundingRateCap` times 100, and 182 of the 183 intervals are equal, P2 `binance` mode.
The exceptions are `KODEX200` at 3.0 against Binance's 1.0 with 8 h against 4 h, and `KORU` and `KSTR` at 3.0 against 2.0, P2.

### How CCXT 4.5.68 maps it

| CCXT field | value | line in `grvt.js` |
|---|---|---|
| `id` | `instrument`, such as `BTC_USDT_Perp`, which the socket's `selector` and `feed.instrument` spell the same, see [`websocket.md`](./websocket.md) section 3 | 706 |
| `type` | `swap` only for `kind` `PERPETUAL` | 698 |
| `linear` | true | 722 |
| `contractSize` | 1, "tbd, vague response from support", which matches the book's base-coin sizes | 724 |
| `active` | `undefined`, "todo: ask support to add", so the 10 `DELISTED` rows count as active | 720 |
| `base` | `base` through `safeCurrencyCode`, with no `commonCurrencies` table, so `KPEPE` stays `KPEPE` | 689 to 692 |
| `taker`, `maker` | `undefined`, see [`fees.md`](./fees.md) section 8 | |

`fees-probe.py` confirmed 194 swaps with `active` `None`, `linear` true, `contractSize` 1.0 and no taker, P1 and P2.

### What the catalog needs changed

1. Keep only `status` `ACTIVE`, or send `{"is_active":true}`, because CCXT's call returns the 10 `DELISTED` rows with `active` unset.
2. Give `KBONK`, `KPEPE` and `KSHIB` a price scale of 0.001 and the bases `BONK`, `PEPE` and `SHIB`, as the Hyperliquid loader does for its `k` names with `THOUSANDS_SCALE` at [`markets.rs`](../../../server/src/venues/hyperliquid/markets.rs) line 17, or the bases `1000BONK`, `1000PEPE` and `1000SHIB` with scale 1 to meet Binance's and Bybit's names.
3. Keep the 106 equity and commodity perpetuals under decision 4 of the waves design, and let the identity check of decision 15 judge them.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | scope | time |
|---|---|---|---|---|---|---|---|
| `full/v1/ticker` | `index_price` | `mark_price` | `funding_rate` | absent | `next_funding_time` | one instrument | 110.7 ms median |
| `full/v1/mini` | `index_price` | `mark_price` | absent | absent | absent | one instrument | not timed |
| `full/v1/all_instruments` | absent | absent | absent | `funding_interval_hours` | absent | every instrument | 136.4 ms |
| socket `v1.ticker.d` | `index_price` | `mark_price` | `funding_rate` | `funding_interval_hours` in its first frame | `next_funding_time` | one instrument per selector | pushed on change, see [`websocket.md`](./websocket.md) section 2 |

No REST call returns the index, mark or funding of every market at once, S1.
S1 asks of both ticker calls: "Please do not use this to repeatedly poll for data".
A sweep of the 184 active perpetuals at 8 calls a second took 23.2 s and 23.1 s, P1 and P2.
At the whole published budget of 1,500 ticker calls a minute a sweep would still take 7.4 s, longer than the sweep of about 3 s that decision 18 of the waves design allows, and it would leave no budget for anything else.
So the anchor comes from the socket's `v1.ticker.s`, through `SocketAnchors`, see section 8.
Checked on 2026-10-12, every `v1.ticker.s` push on `BTC`, `KPEPE` and `AAPL` carried `mark_price`, `index_price`, `funding_rate` and `next_funding_time`, 0.5 to 1 s apart, and only the first push of a subscription carried `funding_interval_hours`.

All 184 rows of each sweep had a positive `mark_price` and `index_price`, P1 and P2.
67 and 62 rows read `funding_rate` `"0.0"`, among them many equities and `BNB`, so zero is a value and not an absence, P1 and P2.
`next_funding_time` named 2026-10-13 00:00 UTC on 183 rows and 23:00 UTC on `KAIA`, the one 1 h market, P1 and P2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `instrument` of the ticker, or the instrument before `@` in the socket's `selector` | `BTC_USDT_Perp` | as is, it is CCXT's `market.id` |
| `index` | `index_price` | decimal string, "expressed in 9 decimals" | parse |
| `mark` | `mark_price` | decimal string | parse, never 0 on a live row |
| `funding_rate` | `funding_rate` | percent per funding interval, see section 4 | divide by 100 |
| `funding_interval_hours` | `funding_interval_hours` of the catalog row, which the ticker's first socket frame repeats | integer hours, 1, 4 or 8 | as is |
| `next_funding_at` | `next_funding_time` | Unix nanoseconds as a string | divide by 1,000,000 |

`AnchorRow` is at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 27.

## 4. Anchor semantics

### Index

S5 says the index is a spot benchmark, and "When the Binance index is fresh we prioritize it".
When Binance's index is slightly stale GRVT interpolates, and when it is unavailable GRVT falls back to "our oracle composite", S5.
S6, the contract specification of 29 April 2026, says "Index Price: Weighted average price from various sources, provided by Block Scholes".
S7, the mark price article, names the "Block Scholes Index Price" as the oracle price.
On the wire `index_price` is Binance's index.
In ten samples a second apart on `BTC`, `ETH`, `SOL`, `DOGE`, `XRP` and `LINK`, 12 of 60 readings in P1 and 34 of 60 in P2 were within 1 ppm of Binance USD-M `premiumIndex` `indexPrice` read in the same second, and 26 and 28 were within 1 ppm of Binance's reading one second earlier, `binance` mode.
`XRP` read 1.3536271 on GRVT against 1.35362710 on Binance, P1, and the widest gaps were 439.3 ppm on `DOGE` and 413.6 ppm on `ETH` while they moved, P1 and P2.
`KBONK` read an index of 0.003258379 against 0.00325838 for Binance's `1000BONKUSDT`, P2.
So GRVT's index trails Binance's by about one Binance publication, and a GRVT and Binance route reads one index twice.
No basket call is published, S1.

Perpetuals on equities and commodities use their own index modes: every second in regular hours, a fast-decay EWMA before and after the session, a slow-decay EWMA overnight, and a fixed index on weekends, holidays and daily maintenance, S8.
At about 22:22 and 22:44 UTC every row read `session` `REGULAR` and `status` `ACTIVE`, including Korean equities whose market was closed, so `session` does not report the underlying's hours, P1 and P2.

### Mark

| source | formula |
|---|---|
| S6, 29 April 2026 | the median of the oracle price plus a 150 s EMA of the fair price's premium, capped at 5 % of the oracle, the fair price, which is the median of best bid, best ask and last trade, and the oracle price |
| S7, 12 February 2026 | the same median, with the third input the oracle provider's "original (legacy) Mark Price", "A volume- and deviation-weighted average of large CEX perpetual exchanges' mid prices" |
| S9, 5 September 2025 | "External vendor provided price: a volume-weighted average of perps' mid prices at several top exchanges" |

S7 says the mark "updates approximately once per second, whenever validators publish new oracle prices".
Equity marks are held within ± 8 % of the index in regular, pre-market and after hours, ± 5 % overnight and ± 3 % on weekends and holidays, and commodity marks within ± 3 % at all times, S8.
When the underlying market is closed, an equity mark is an EWMA of the last price, S8.
So an equity mark held at its band is a capped mark, the shape that already produced false rows on Kraken, because the reader takes a capped leg as fresh.
At 22:22 and 22:44 UTC the widest mark to index gaps were on equities and ETFs whose markets were closed: `EWT` 7,933 and 8,939 ppm, `KODEX200` 6,392 and 7,467 ppm, and `KSTR` 4,156 and 4,147 ppm, P1 and P2.

### Funding

The formula, caps and intervals are in [`fees.md`](./fees.md) section 6.
`funding_rate` is "The current indicative funding rate for the active interval", ending at `next_funding_time`, S1, so it is the coming settlement's rate.
At 22:23 and 22:45 UTC `BTC` read 0.01 while its last settled rate, at 16:00 UTC, was 0.008, and `KAIA` read 0.0012 while its 22:00 UTC rate was 0.001, P1 and P2.
The ticker documentation gives its unit as "centibeeps", while the funding history documentation says "percentage points", S1.
The wire is percent: `BTC` read 0.01, the 0.01 % baseline of S5's clamp, under a cap of 0.3 where Binance's `fundingInfo` gives 0.00300, and the `ONE_HOURLY` history turned the 0.008 of an 8 h interval into 0.001 an hour, P1 and P2.
`funding_rate_8h_curr` and `funding_rate_8h_avg` are deprecated, S1, and repeated `funding_rate` on the five markets of the `funding` mode, P1 and P2.
Settlements in the history sat exactly on the hour, P1, and no probe waited for one.

### How often each number changed

| market | REST polls a second apart | `mark_price` changed | `index_price` changed | `event_time` step | age at arrival, median and max |
|---|---:|---:|---:|---|---|
| `BTC_USDT_Perp` | 60 in each pass | 42 and 59 of 59 | 44 and 44 of 59 | 1,000 ms | 120.1 and 79.5 ms, max 620.2 and 94.9 ms |
| `ETH_USDT_Perp` | 60 in each pass | 48 and 43 of 59 | 43 and 41 of 59 | 1,000 ms | 226.8 and 186.5 ms, max 731.5 and 695.2 ms |
| `BCH_USDT_Perp` | 60 in each pass | 48 and 46 of 59 | 53 and 52 of 59 | 1,000 ms | 337.5 and 296.3 ms, max 1,342.9 and 1,296.3 ms |

Pairs are P1 and P2.
The REST ticker is a snapshot republished once a second, since its `event_time` stepped by exactly 1,000 ms and sat at the same millisecond within each second.
On the socket, `v1.ticker.d` at 100 ms changed `BTC`'s mark 55 and 46 times and its index 49 and 41 times in 40 s, see [`websocket.md`](./websocket.md) section 2.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `full/v1/book` with `{"instrument":"BTC_USDT_Perp","depth":50}`, S1 |
| depths | 10, 50, 100 and 500, S1. Depth 20 answered 400 `{"code":3031,"message":"Depth is invalid","status":400}`, P1 and P2 |
| depth 500 on `BTC` | 232 and 231 bids, 101 and 89 asks, the whole book, P1 and P2 |
| level order | bids from the highest price down, asks from the lowest up, P1 and P2 |
| fields | `price` and `size` as strings, `num_orders` as an integer, `event_time` in ns, P1 and P2 |
| caching | none seen: six calls 250 ms apart returned `event_time` steps of 250 to 650 ms on a 50 ms grid, P1 and P2 |
| advice | "Do not use this to poll for data", S1 |

The socket sends its own snapshot on subscribe, so a feed never needs this call, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| limit | value | source |
|---|---|---|
| `GetInstrument`, `MiniTicker` and `Ticker` | 1,500 a minute | S2 |
| every other market data call | 500 a minute | S2 |
| JSON-RPC calls on a socket | counted against the same limits | S2 |
| headers | `x-ratelimit-limit: 1500` and `x-ratelimit-remaining: 1499` on `ticker` replies | P1, P2 |
| over the limit | code 1006, HTTP 429, "You have surpassed the allocated rate limit for your tier" | S1 |
| `Retry-After` | not documented, and no limit was reached | S1, P1, P2 |

The poller already pauses on 429 at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 21.

| case | status | body, P1 and P2 unless marked |
|---|---|---|
| `ticker` for `NOPE_USDT_Perp` or `btc_usdt_perp` | 400 | `{"code":1003,"message":"Request could not be processed due to malformed syntax","status":400}` |
| `book` for `NOPE_USDT_Perp` | 400 | the same 1003 |
| `ticker` for the delisted `TON_USDT_Perp` | 200 | a frozen ticker: `mark_price` 1.621086243, `index_price` 1.565289171, best bid and ask `"0.0"`, P2 |
| `book` for the delisted `TON_USDT_Perp` | 200 | `{"result":{"event_time":"0","instrument":"TON_USDT_Perp","bids":[],"asks":[]}}`, P2 |
| `ticker` with `{}` | 404 | `{"code":1004,"message":"Data Not Found","status":404}` |
| `ticker` as a GET | 405 | empty |
| malformed JSON | 400 | the same 1003 |
| an unknown path | 404 | `404 page not found` as plain text |
| `lite/v1/ticker` with `{"i":"BTC_USDT_Perp"}` | 200 | the ticker with short keys, `{"r":{"et":…,"i":"BTC_USDT_Perp","mp":…` |

The socket answers an unknown instrument with code 3000 instead, see [`websocket.md`](./websocket.md) section 4.

## 7. Server time and clock offset

The market data API documents no server time call, and the "Server Time" anchor that the login pages link to does not exist on its page, S1.
Every reply carries `event_time` in Unix ns, which GRVT says is "stamped by our core cluster, and is guaranteed to be consistent across all services and nodes", S1.
Socket deltas arrived a minimum of 53.3 ms after their `event_time`, against a warm REST round trip of at least 105.7 ms, P1 and P2.
That is about half the round trip, so the two clocks agree to within a few ms if the path is symmetric.
The offset cannot be read apart from the one-way delay without a time call.

## 8. Recommended poller shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| source | `SocketAnchors` at [`socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs) line 9, written by the book socket's `v1.ticker.s` frames | no bulk REST call exists, section 3, and decision 13 of the waves design covers a socket anchor |
| subscription | `v1.ticker.s` at 500 ms per market, beside its `v1.book.d`, see [`websocket.md`](./websocket.md) section 8 | every push carries every field on its clock, even on the thinnest market, while a `v1.ticker.d` delta leaves out what did not change, so under decision 13's rule that a row is as old as its older price a quiet market's row would age past 10 s |
| `set_index`, `set_mark` | on every ticker frame, at `frame_recv_ts` | each `v1.ticker.s` frame carries both prices |
| `set_funding` | on every ticker frame, with the rate divided by 100, the catalog's interval, and the time divided by 1,000,000 | `set_funding` at line 60 of `socket_anchors.rs` takes all three at once |
| interval | the catalog's `funding_interval_hours`, refreshed when a ticker frame carries it | only the first frame of a subscription carries it |
| `publishes_mark` | true | every row had a mark |
| `poll_every` | the default 1 s at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 55 | the rows are in memory, so a round costs nothing |
| skip | `DELISTED` rows, which section 2 already drops | their ticker is frozen |
| flag | equity and commodity marks during closed sessions, which sit on an EWMA within a capped band, section 4 | the reader can take a capped leg as fresh |
| REST fallback | none | a 184-call sweep takes 23 s at a third of the budget |

## 9. Decentralised layer

### Chain and sequencer

GRVT runs "a custom Layer 2 built on the ZKsync (ZK) stack, with off-chain matching and zero-knowledge settlement to Ethereum mainnet", S10, with L2 chain id 325 on mainnet, S1.
The matching engine, the trading engine and the risk engine run off chain, S11, operated by Albatross Group Overseas S.A. of Panama, which "operates and owns the centralised aspects of this Platform, including the Central Limit Order Book", S12.
Matched trades, liquidations, account actions and transfers are pushed to the GRVT chain, and their proofs to Ethereum, S13.
Order and position data are "not broadcast to the public chain", S10, so the book can be read only through GRVT's API and not from a node.
Book and anchor times are `event_time`, stamped by GRVT's core cluster in Unix ns, S1, and not block times.
The order path adds "a 25ms speedbump for major trading pairs and a 50ms speedbump for altcoins", S14.

### Who may use it and from where

Registration takes an email or a wallet, and every order is signed by a registered wallet, S13.
The restricted list bars residents of the United States, Canada, Singapore, Hong Kong and fourteen other jurisdictions, see [`fees.md`](./fees.md) section 1.
From this Canadian exit every public market data call and socket answered, and only the documentation host refused, by client and not by address, section 1.

### Oracle

The index on the wire is Binance's USD-M index, trailing it by about a second, with Block Scholes as the documented oracle and fallback, section 4.
The mark is a median that mixes Block Scholes's oracle, GRVT's own book and, in one version, Block Scholes's perpetual mark, section 4.
S7 says the mark moves "whenever validators publish new oracle prices", and no page names those validators.

### Who can list a market

Only GRVT lists: every perpetual in the catalog is GRVT's own, with `venues` `ORDERBOOK` and `RFQ`, and no page or API offers a listing by a third party, S1 and P1.
Builder codes let a third party route orders into GRVT's book for a fee, S15, and create no market.
So each ticker is GRVT's choice, and three of them, `KBONK`, `KPEPE` and `KSHIB`, name 1,000 coins, section 2.

### Routing

CCXT 4.5.68 is itself a builder: it signs every GRVT order with builder `0x21d2a053495994b1132a38cd1171acec40c6741e` and a fee of 0.01 %, at `grvt.js` lines 191 to 193 and 2086 to 2090, S16.
[`2026-09-22-venue-survey.md`](../../research/2026-09-22-venue-survey.md) names no venue that routes its perpetuals to GRVT, and GRVT matches every order on its own engine, S11.
The RFQ venue that every instrument lists is GRVT's own, S1.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Market Data API and Overview, fetched with a browser user agent | https://api-docs.grvt.io/market_data_api/ and https://api-docs.grvt.io/ | 2026-10-12 | GRVT, API docs | calls, fields, units, errors, `event_time`, hosting, chain ids, sections 1 to 7 and 9 |
| S2 | What are the rate limitations on Grvt?, dated June 26, 2026 | https://help.grvt.io/en/articles/9636566-what-are-the-rate-limitations-on-grvt | 2026-10-12 | GRVT, help center | REST limits, section 6 |
| S3 | CCXT 4.5.68 `grvt.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/grvt.js` | 2026-10-12 | CCXT | lines 627, 689 to 692, 698, 706, 720, 722 and 724, section 2 |
| S4 | CCXT 4.5.68 `fetchTicker` and `fetchFundingRateHistory` in `grvt.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/grvt.js` | 2026-10-12 | CCXT | `markPrice` and `indexPrice` at lines 922 and 923, `fundingRate` passed through unscaled at line 1272, sections 3 and 4 |
| S5 | Funding Rate Mechanism | https://help.grvt.io/en/articles/12555039-funding-rate-mechanism | 2026-10-12 | GRVT, help center | the Binance index, funding formula, section 4 |
| S6 | Contract Specifications (Cryptocurrency), PDF of 29 April 2026 | https://help.grvt.io/en/articles/10258593-what-are-grvt-s-perpetual-contract-specifications | 2026-10-12 | GRVT, contract terms | index and mark definitions, section 4 |
| S7 | What Is the Grvt Mark Price and How Is It Calculated?, dated February 12, 2026 | https://help.grvt.io/en/articles/13713807-what-is-the-grvt-mark-price-and-how-is-it-calculated | 2026-10-12 | GRVT, help center | mark formula and cadence, sections 4 and 9 |
| S8 | Information Specific to Perpetuals on Traditional Assets, dated March 11, 2026 | https://help.grvt.io/en/articles/14033372-information-specific-to-perpetuals-on-traditional-assets | 2026-10-12 | GRVT, help center | equity and commodity index modes and mark bands, section 4 |
| S9 | Price Protection Bands, dated September 5, 2025 | https://help.grvt.io/en/articles/12164232-price-protection-bands | 2026-10-12 | GRVT, help center | the older mark definition, section 4 |
| S10 | Grvt Litepaper | https://help.grvt.io/en/articles/15942962-grvt-litepaper | 2026-10-12 | GRVT, help center | ZKsync-stack Layer 2, privacy of order data, section 9 |
| S11 | What are the off-chain elements on GRVT? | https://help.grvt.io/en/articles/9610076-what-are-the-off-chain-elements-on-grvt | 2026-10-12 | GRVT, help center | off-chain matching, section 9 |
| S12 | User Agreement, PDF of 14 September 2026 | https://help.grvt.io/en/articles/9614719-user-agreement | 2026-10-12 | Albatross Group Overseas S.A., Panama | the operator of the order book, section 9 |
| S13 | Learn, Architecture Overview and User Registration | https://api-docs.grvt.io/learn/ | 2026-10-12 | GRVT, API docs | on-chain actions, registration, section 9 |
| S14 | Grvt MM Program, dated May 26, 2026 | https://help.grvt.io/en/articles/13606302-grvt-mm-program | 2026-10-12 | GRVT, help center | the speedbump, section 9 |
| S15 | Builder Codes | https://help.grvt.io/en/articles/13134727-builder-codes | 2026-10-12 | GRVT, help center | builders route orders, section 9 |
| S16 | CCXT 4.5.68 `grvt.js` options and `createOrder` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/grvt.js` | 2026-10-12 | CCXT | the builder code at lines 191 to 193 and 2086 to 2090, section 9 |
| P1 | `rest-probe.py` modes `host` and `catalog` at 22:21, `anchor` from 22:21 to 22:23, `funding`, `book` and `errors` at 22:23, `binance` at 22:23 and `collisions` at 22:35 UTC, and `fees-probe.py` mode `ccxt` at 22:24 UTC | [`rest-probe.py`](../../../scripts/probes/venues/grvt/rest-probe.py), [`fees-probe.py`](../../../scripts/probes/venues/grvt/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 9 |
| P2 | every `rest-probe.py` mode rerun from 22:43 to 22:46 UTC, `fees-probe.py` at 22:46 UTC, then `binance` with the cap comparison at 22:48, `collisions` with Binance's `TRADIFI_PERPETUAL` contracts at 22:49 and `host` with the curl check at 22:52 UTC | [`rest-probe.py`](../../../scripts/probes/venues/grvt/rest-probe.py), [`fees-probe.py`](../../../scripts/probes/venues/grvt/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 6 and 9 |
