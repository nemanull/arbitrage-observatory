# Derive REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:20 to 22:42 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public JSON-RPC API of Derive (CCXT id `derive`) that a catalog, an anchor and a book would use.
Derive moved from its v2 API at `api.lyra.finance` to its v3 API at `api.derive.xyz/v3` on 2026-10-06, and CCXT 4.5.68 still reads v2, section 9.
Every call is a `POST` of a JSON params object to `https://api.derive.xyz/v3/public/<method>`, and nothing here signs or calls a private method.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/derive/rest-probe.py), run with `uv run` from the repository root.
P1 is the first run of each mode and P2 the rerun.
Modes `host`, `catalog`, `anchor`, `errors` and `legacy` ran first from 22:20 to 22:31 UTC and again from 22:31 to 22:34 UTC.
Modes `funding` and `identity` ran first at 22:38 and 22:39 UTC and again at 22:41 UTC, and `errors` ran a third time at 22:40 UTC to add `get_live_incidents`.
The probe kept to 2 requests a second or fewer, against a documented public budget of 5 a second per IP.
Where the documentation and the wire disagree, both are written.
Fees and who may trade are in [`fees.md`](./fees.md), and the socket in [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 | edge |
|---|---|---|---|
| `api.derive.xyz` | v3 REST at `/v3` and socket at `/v3/ws`, S1 | `104.26.14.65`, `104.26.15.65`, `172.67.70.234` and three IPv6 addresses | Cloudflare, `server: cloudflare`, `cf-ray` ending `SEA` or `YVR` |
| `api.lyra.finance` | v2 REST, the host of CCXT 4.5.68 | `104.20.44.138`, `172.66.157.100` and two IPv6 addresses | Cloudflare, with `allow: GET, POST, HEAD, OPTIONS` and `vary: Accept, Cookie, origin` from the origin |

| call | first request of a process | requests on the kept connection | reply |
|---|---:|---|---:|
| v3 `public/get_time` | 180 ms in P1, 136 ms in P2 | ten a run: min 109, median 135, max 142 ms in P1, and min 105, median 114, max 120 ms in P2 | |
| v2 `public/get_time` | 342 ms in P1, 355 ms in P2 | ten a run: min 111, median 126, max 139 ms in P1, and min 110, median 125, max 244 ms in P2 | |
| v3 `public/get_all_instruments`, perpetuals | 147 and 150 ms | | 13,044 to 13,046 bytes |
| v3 `public/get_tickers`, perpetuals | | 60 polls a run: median 106 and 108 ms, p90 117 and 120 ms, max 277 and 171 ms | 4,618 to 4,646 bytes |

Replies came gzip encoded when asked.
Every public call answered from this host, and none was a refusal or a geoblock, in P1 and P2.

## 2. Catalog

### The instruments calls

| call | params | returns |
|---|---|---|
| `public/get_all_instruments` | `instrument_type` `perp`, `expired` false, optional `currency`, `risk_universe_id`, `page` and `page_size` up to 1,000, S2 | full instrument rows and `pagination`. Perpetuals ignore `expired`, and an empty listing is error `12001`, S2 |
| `public/get_all_live_instruments` | none, S2 | the sorted names of every live instrument |
| `public/get_instrument` | `instrument_name` | one full row |
| `public/get_risk_universes` | none | each universe with its managers and the instruments they price |

On the wire `get_all_instruments` returned 15 perpetual rows on one page, `num_pages` 1 and `count` 15, every one `is_active` true, P1 and P2.
`get_all_live_instruments` listed the same 15 perpetual names, P1 and P2.
A page holds 100 rows when `page_size` is left out, as the 4,876 live options came back over 49 pages, checked by the builder on 2026-10-12.
A `page_size` of 1,001 was refused with `-32602` and "'page_size' must be an integer between 1 and 1000", checked on 2026-10-12.

| name | tick | amount step | minimum amount | max leverage, `srm_perp_margin_requirements` | listed, `scheduled_activation` |
|---|---|---|---|---|---|
| `ADA-PERP` | 0.0001 | 0.1 | 10 | 5 | 2026-03-21 |
| `BNB-PERP` | 0.01 | 0.0001 | 0.1 | 10 | 2024-10-10 |
| `BTC-PERP` | 0.1 | 0.0001 | 0.01 | 15.15 | 2023-12-06 |
| `CC-PERP` | 0.0001 | 0.1 | 10 | 6.67 | 2026-06-04 |
| `DOGE-PERP` | 0.00001 | 1 | 1,000 | 10 | 2024-04-28 |
| `ETH-PERP` | 0.01 | 0.001 | 0.1 | 15.15 | 2023-12-06 |
| `HYPE-PERP` | 0.001 | 0.01 | 1 | 10 | 2025-10-28 |
| `LINK-PERP` | 0.0001 | 0.001 | 10 | 10 | 2024-11-04 |
| `LIT-PERP` | 0.001 | 0.1 | 10 | 6.67 | 2026-09-14 |
| `PUMP-PERP` | 0.000001 | 10 | 1,000 | 6.67 | 2026-09-14 |
| `SOL-PERP` | 0.001 | 0.001 | 0.1 | 12.99 | 2024-04-28 |
| `VVV-PERP` | 0.001 | 0.01 | 1 | 5 | 2026-09-14 |
| `XAUT-PERP` | 0.01 | 0.001 | 0.1 | 10 | 2026-06-04 |
| `XRP-PERP` | 0.00001 | 0.1 | 10 | 10 | 2024-11-04 |
| `ZEC-PERP` | 0.01 | 0.01 | 1 | 6.67 | 2026-06-04 |

Every row had `quote_currency` `USDC`, `base_fee` `0.01`, `taker_fee_rate` `0.0003`, `maker_fee_rate` `0.0001`, and `perp_details.index` `<BASE>-USD`, P1 and P2.
`scheduled_deactivation` was `9223372036854775807` on 14 rows and `4870198916`, the year 2124, on `DOGE-PERP`.
No name carried a risk universe suffix, and no base was listed twice, P1 and P2.
The OpenAPI file makes `risk_universe_id` a required field of every instrument row, S2, but no perpetual row and no `get_instrument` reply carried it, P1 and P2.
`get_risk_universes` placed `BTC-PERP` and `ETH-PERP` in universe 1 `PRIME`, `HYPE-PERP` in 2 `MIDCAP`, `XAUT-PERP` in 4 `RWA`, and the other eleven in 3 `ALT`, P1 and P2.
The parameters page's universe table leaves `BNB` and `DOGE` out of Alt, and the risk universes page adds only "(+ listed alt perps)" to its list, S11, while the wire lists both in Alt.

The wider catalog held 11 spot pairs, such as `ETH-USDC` and `DRV-USDC`, and 4,876 live option rows, P1 and P2.
They are out of scope.

### How CCXT 4.5.68 maps it

| item | value | evidence in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/derive.js` |
|---|---|---|
| host | `https://api.lyra.finance/public`, the v2 API | line 143 |
| calls | `get_all_instruments` three times, for `erc20`, `perp` and `option`, each with `expired` false | lines 539, 595, 603 to 606 and 615 |
| `market.id` | `instrument_name`, such as `BTC-PERP` | lines 636 and 681 |
| `base` | `base_currency` through `safeCurrencyCode`, with an empty `commonCurrencies` | lines 634 and 415 |
| `quote` | `quote_currency`, which is `USD` on v2 | lines 633 and 635 |
| `settle` | the literal `USDC` | line 650 |
| `linear` | the literal true for a perpetual | line 654 |
| `contractSize` | the literal 1 | line 678 |
| `active` | `is_active` | line 695 |
| `taker` | `taker_fee_rate`, see [`fees.md`](./fees.md) section 8 | line 702 |
| `has.swap` | false, although `fetchMarkets` returns swaps | line 35 |

The fees probe loaded 135 markets through CCXT, 20 spot, 15 swap and 100 option, in 1.0 and 1.1 s, P1 and P2.
The 100 options are only the first page, because CCXT sends no `page_size` and v2 also pages at 100 rows, with 3,810 live options over 39 pages, checked by the builder on 2026-10-12.
All 15 swaps were active and linear, with `contractSize` 1, quote `USD`, settle `USDC` and the same ids as v3, P1 and P2.

### What the catalog needs changed

- The loader reads v3, `https://api.derive.xyz/v3/public/get_all_instruments`, because the v2 host CCXT reads is frozen, section 9.
  The names are the same on both, so the CCXT dump stays a fair parity target for ids, sizes and activity.
- `quote` differs: v3 says `USDC` and CCXT says `USD`.
  Both sit under `USDT` in the quote family, so the clusters do not change, but the parity check must expect this one difference.
- `rawMarketId` is `instrument_name`, which is CCXT's `market.id` and the socket's channel and data name, [`websocket.md`](./websocket.md) section 4.
- Contract size 1 is right, because book amounts are coins of the base currency, [`websocket.md`](./websocket.md) section 4.
- A market is kept when `is_active` is true and the current time lies between `scheduled_activation` and `scheduled_deactivation`, which are Unix seconds, the window `get_all_live_instruments` also applies, S2.
- A second listing of one currency in another risk universe would be named `<CURRENCY>-PERP-<id>`, and only one listing may omit the suffix, S8.
  None exists, and if one appears, the unsuffixed name is the one to keep, since the engine takes one market per pair.
- No price scale is needed: no name is quoted per 1,000 units, and every index sat within 0.2 % of Bybit's index for the same token, section 9.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `public/get_tickers` with `instrument_type` `perp` | `I` | `M` | `f`, per hour | absent | absent, funding is continuous | 4.6 KB, 15 rows keyed by name | median 106 and 108 ms |
| `public/get_ticker` per name | `I` | `M` | `f` | absent | absent | 346 bytes | 105 and 108 ms |
| `ticker_slim.{name}.1000` on the socket | `I` | `M` | `f` | absent | absent | 430 bytes in the captured `SOL-PERP` frame | every 1,011 ms at p50, [`websocket.md`](./websocket.md) section 2 |
| `public/get_all_instruments` | none | none | `perp_details.funding_rate`, which read `0` on all 15 while `f` read `0.000012500` | | | 13 KB | 147 and 150 ms |

`get_tickers` returns `{"tickers":{name: row}}`, and each row is the slim ticker of S3: `t`, `a`, `A`, `b`, `B`, `I`, `M`, `f`, `minp`, `maxp`, `stats` and `option_pricing`.
`t` is the snapshot's creation time in ms, S3.

The REST snapshots are old when they arrive.
Over 60 one-second polls, `t` on a perpetual was 132 to 15,122 ms older than the reply's arrival, with per-perpetual medians of 6,693 to 8,702 ms in P1 and 6,518 to 7,538 ms in P2.
Across all 15 perpetuals in P2 the age was median 7,072 ms, p90 11,313 ms and max 15,122 ms, and 20.9 % of readings were older than 10 s.
On `BTC-PERP` in P2 the age climbed by about 1 s per poll and fell back every 8 to 12 polls, so the reply is a cached snapshot that is rebuilt every 8 to 12 s.
Three of those 60 replies were about 11 s older than the replies on either side, as if a second cache had answered.
Each perpetual's `t` changed only 6 to 14 times in 60 polls, P1 and P2.
The socket's `ticker_slim` `t` was 52 to 175 ms old at arrival over 2,520 frames, [`websocket.md`](./websocket.md) section 4.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the instrument name, from the channel `ticker_slim.{name}.1000` | `BTC-PERP` | as is |
| `index` | `I` | decimal string, never 0 on a live row in P1 and P2 | parse |
| `mark` | `M` | decimal string, never 0 on a live row in P1 and P2 | parse |
| `fundingRate` | `f` | the current rate per hour as a fraction, `0.000012500` is 0.00125 % an hour, S4 and S5 | parse |
| `fundingIntervalHours` | none | the rate is per hour, S4 and S5 | the constant 1 |
| `nextFundingAt` | none | funding settles continuously, so there is no next settlement, S6 | 0, which decision 20 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) reads as unknown |
| `ts` | the frame's arrival | | the arrival of the `ticker_slim` frame, which carries index and mark together |

## 4. Anchor semantics

### Index

`perp_details.index` names the index `BTC-USD` for `BTC-PERP`, and so on for every base, P1 and P2.
The index is the spot feed of the underlying, which Block Scholes provides, S7.
Feeds are signed and posted on chain, and each carries a `confidence` from 0 to 1, S7.
`public/get_latest_signed_feeds` returned for `BTC` a `spot_data` row with `price`, `confidence` 1, a `timestamp` in whole seconds and a `deadline` 3,600 s later, signed by `0x47ebfbada4d85dac6b9018c0ce75774556a8243f` and `0x555eb362b5057e36f88ccb42b44d6da5fe7a0656`, P1 and P2.
That signed spot row was 7.0 s old in P2, while the ticker's `I` was refreshed every second on the socket.
The socket channel `spot_feed.BTC` sent the oracle spot price about every 3 s, [`websocket.md`](./websocket.md) section 2.
The per-asset list of source exchanges and their weights is `Not publicly specified`, in S7 or anywhere in the v3 documentation.
Since the index is a spot price, it does not contain Derive's own perpetual, and the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) does not apply.

### Mark

`Perpetual Mark Price = Spot Price + 30 minute TWAP(Perpetual Mark Price - Spot Price)`, S6, with `PERP_TWAP_LENGTH` 30 minutes, S4.
The mark is clamped to between 0.94 and 1.06 times spot, `PERP_MAX_PERCENT_DIFF` 0.06, S4 and S6.
The signed `perp_data` row carries that TWAP as `spot_diff_value`: 24.08 on `BTC` in P1, when the last polled ticker read `M - I` = 24.1, and 28.67 in P2 against 28.7.
So the mark's premium over the index is a 30-minute average.
A sudden move of Derive's own book shows in the mark only slowly, and the 6 % clamp is far wider than any premium seen.
`M / I - 1` lay between -0.000861 and +0.000829 on the last P1 poll and between -0.000840 and +0.000829 on the last P2 poll, over 15 perpetuals.

### Funding

The rate formula, the caps and the per-hour unit are in [`fees.md`](./fees.md) section 6.
`f` is the "Current hourly funding rate", S3, and so the rate that accrues now.
Funding is never paid at an instant: it accrues continuously and settles when a position changes or anyone calls settle, S6.
`f` read `0.000012500` on 15 of 15 perpetuals at every poll in P1 and P2, which is the static interest rate alone, S4.
`public/get_funding_rate_history` returns one hourly candle of the per-hour rate, with `open`, `high`, `low`, `close`, `funding_rate` and `risk_universe_id`, and its timestamps fall on the hour, 24 of 24 in each run.
From the first v3 hour, 2026-10-06 18:00 UTC, to the probe, the history shows how rarely the rate left the static value:

| perpetual | hourly rows | hours at `0.000012500` throughout | highest | lowest |
|---|---:|---:|---|---|
| `ADA-PERP` | 149 | 148 | 0.000028539 | 0.000012500 |
| `BNB-PERP` | 149 | 149 | 0.000012500 | 0.000012500 |
| `BTC-PERP` | 149 | 140 | 0.000027537 | -0.000028539 |
| `CC-PERP` | 149 | 149 | 0.000012500 | 0.000012500 |
| `DOGE-PERP` | 149 | 149 | 0.000012500 | 0.000012500 |
| `ETH-PERP` | 149 | 44 | 0.000012500 | -0.000028539 |
| `HYPE-PERP` | 149 | 115 | 0.000028539 | -0.000007098 |
| `LINK-PERP` | 149 | 149 | 0.000012500 | 0.000012500 |
| `LIT-PERP` | 149 | 149 | 0.000012500 | 0.000012500 |
| `PUMP-PERP` | 149 | 148 | 0.000028539 | 0.000012500 |
| `SOL-PERP` | 149 | 143 | 0.000016934 | 0.000004560 |
| `VVV-PERP` | 149 | 149 | 0.000012500 | 0.000012500 |
| `XAUT-PERP` | 137 | 102 | 0.000012500 | -0.000028539 |
| `XRP-PERP` | 149 | 148 | 0.000021588 | 0.000012500 |
| `ZEC-PERP` | 149 | 148 | 0.000028539 | 0.000012500 |

Seven perpetuals touched exactly ±0.000028539 an hour and none went past it, although every instrument row gives `max_rate_per_hour` `0.000171232876`.
0.000028539 × 8,760 is 0.25, so the wire behaves as if a bound of 25 % a year acts, which no document states.
`XAUT-PERP` lacks 12 of the 149 hours.

### How often each number changed

| source | `I` | `M` | `f` |
|---|---|---|---|
| `get_tickers`, 60 one-second polls | 0 to 14 changes per perpetual, P1 and P2 | 0 to 14 changes | 0 |
| `ticker_slim.{name}.1000`, 168 frames in 170 s | 9 changes on `CC-PERP` to 141 on `ZEC-PERP` in P1, and 7 to 151 in P2 | 9 to 146 changes in P1, and 15 to 150 in P2 | 0 |

So the index and the mark move about every second on the socket, while REST shows them every 8 to 12 s.

## 5. REST book snapshot

v3 has no public order book call: none of the 44 public methods in the OpenAPI file returns depth, S2.
`public/get_ticker` gives only the best bid and ask with their amounts.
CCXT declares `fetchOrderBook` false, at line 96 of its class.
None is needed, because every socket frame is a whole book, [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public budget | 5 requests a second per IP, a fixed window of 25 points per 5 s, every request one point, S9 | `public/getRateLimits` reported `remaining_non_matching` with 2,497 points left after 3 consumed, P1 and P2 |
| response headers | not documented | `x-ratelimit-limit: 500`, `x-ratelimit-remaining: 499` or `498`, and `x-ratelimit-reset: 0` on every v3 reply, P1 and P2 |
| refusal | JSON-RPC error `-32000` "Rate limit exceeded" with `data` "Retry after {ms} ms", S9 | not met, since the probe stayed far below every limit. The HTTP status of a refusal and any `Retry-After` header are unknown |
| sockets | 4 per IP, S9 | [`websocket.md`](./websocket.md) section 5 |

| request | HTTP status | body |
|---|---|---|
| `get_ticker` on `NOPE-PERP` | 200 | `{"error":{"code":-32602,"message":"Invalid params","data":"Ticker not found for instrument"}}` |
| `get_tickers` with `currency` `NOPE` | 200 | `{"result":{"tickers":{}}}` |
| `get_tickers` with `instrument_type` `swap` | 200 | `-32602` with ``Invalid params: unknown variant `swap`, expected one of `option`, `perp`, `erc20` `` |
| an unknown method | 404 | the text `Not Found` |
| a body that is not JSON | 400 | the text `Failed to parse the request body as JSON: key must be a string at line 1 column 2` |
| `GET` on `public/get_time` | 200 | the normal result |

So an application error comes back as HTTP 200 with an `error` object, P1 and P2.
A rate limit refusal may therefore also be a 200, which the poller runtime would not read as a rate limit, since it pauses only on 403, 418 and 429.
`public/get_live_incidents` returned `{"incidents":[]}` on v3 and on v2, in the errors mode at 22:40 UTC.

## 7. Server time and clock offset

`public/get_time` returns the server time in ms, S2.
Five calls a run put the server within -50 to +12 ms of this host's clock at the request's midpoint, P1 and P2.
v2's `get_time` still returns the current time, -56 and -57 ms off, P1 and P2.

## 8. Recommended poller shape

- Read the anchor from the socket through `SocketAnchors`, as decision 13 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) describes.
  The book connection also subscribes `ticker_slim.{name}.1000` for every market, and `handle` writes `I` as the index, `M` as the mark and `f` as the funding rate, each stamped with `Connection::frame_recv_ts`.
  `SocketAnchors::new(true)`, since Derive publishes a mark.
- Do not poll `get_tickers` as the anchor.
  Stamped on arrival, its rows would look fresh while being up to 15 s old.
  Stamped with `t`, one reading in five would be older than the reader's 10 s limit, section 3.
- `fundingIntervalHours` is 1 and `nextFundingAt` is 0 on every row, section 3.
- The catalog is one `get_all_instruments` call at boot, and nothing needs polling apart from it.
- Skip nothing: all 15 perpetuals carry an index and a mark.

## 9. Decentralised layer

### Chain, sequencer and timestamps

v3 runs Derive as one zero-knowledge application that settles to Ethereum L1, S1 and S10.
Margining, settlement and permissioning are compiled into a RISC-V binary and proven off chain with the SP1 Hypercube zkVM, and each batch is verified on L1 with a PLONK proof, S1.
Matching is off chain and "sub-millisecond", S1, and an operation then moves through the batch states `Batching`, `Executing`, `Da`, `Proving`, `Settling` and `Settled`, S10.
The mainnet contracts are on Ethereum, chain id 1, S12.
v2 ran on a separate Derive Chain with a smart contract wallet in front of each user, which v3 removed, S10.
So no price on the API has a block behind it.
A book `timestamp` and a ticker `t` are the matching engine's clock in ms, and they were about 55 ms old on arrival here, [`websocket.md`](./websocket.md) section 4.
Oracle feeds carry their own whole-second `timestamp` and a `deadline` one hour later, section 4, and a feed print may be at most 3,600 s old, `FEED_HEARTBEAT`, S14.

### The v2 to v3 switch

| fact | value | evidence |
|---|---|---|
| v2 newest perpetual trade | `XRP-PERP` at 2026-10-06 17:56:01 UTC, and every other perpetual's last trade on 2026-10-06 | legacy mode, P1 and P2 |
| v3 first funding hour | 2026-10-06 18:00 UTC on every perpetual | funding mode |
| v2 REST today | answers, with the same 15 names, `quote_currency` `USD`, and frozen prices: `BTC-PERP` index 83,216.6 and best bid 83,821 against best ask 86,600 at every read | legacy mode, P1 and P2 |
| v3 at the same time | `BTC-PERP` index near 82,500 | anchor mode, P1 and P2 |
| v2 `get_tickers` | `{"tickers":{}}` | legacy mode, P1 and P2 |
| v2 socket | HTTP 503 from nginx | [`websocket.md`](./websocket.md) section 1 |
| announcement | staking rewards resume "on the 7th of October once stDRV has been migrated to Ethereum mainnet" | S15 |

So Derive switched to v3 at about 18:00 UTC on 2026-10-06, and the v2 REST host now serves a frozen copy that only looks live, because its `timestamp` fields are current.
CCXT 4.5.68 reads that copy: its `fetch_ticker` on `BTC/USD:USDC` returned bid 83,821, ask 86,600 and index 83,216.6, while v3 read about 82,500, [`fees.md`](./fees.md) section 8 and the fees probe.

### Who may use it and from where

The Terms of Use bar US persons, Australian tax residents, residents of Canada and of Panama, and a list of sanctioned places, [`fees.md`](./fees.md) section 1.
The API documents HTTP 403 `restricted_region` for a geoblocked origin, S16, and nothing from this Canadian exit met it.
An account is an Ethereum wallet, an EOA or a multisig, and the first deposit creates its subaccount, S10.

### Oracle

Block Scholes provides the spot, forward, perpetual, volatility and rate feeds that mark every market, S7.
The index is the spot feed, and the mark adds the perpetual feed's 30-minute TWAP of the basis, section 4.
The funding feed is signed by a separate key, `0xf00fe4149432cbb1d8587b7720b1e638a5ed2ef0`, P1 and P2.
Which exchanges feed each spot price, and with what weights, is `Not publicly specified`.

### Who can list a market

Derive lists markets itself, into one of its risk universes, which "lets us significantly ramp up new collateral, perp, and option listings", S13.
The OpenAPI file has no method that creates an instrument, and the only thing a user can create is a vault, `private/create_vault`, S2.
Vaults are permissionless, S13 and S17, but a vault is a trading account and not a market.
A second listing on one currency would carry a `-<id>` suffix, and the unsuffixed name goes to the first listing, S8.
So a Derive ticker cannot be taken by an outside deployer, and the only identity risk is a token that other venues name differently.

The identity mode compared each index with Bybit's index for `<BASE>USDT`:

| perpetual | Derive index, from `get_tickers` | Bybit symbol | Bybit index | ratio |
|---|---|---|---|---|
| `ADA-PERP` | 0.2378 | `ADAUSDT` | 0.2379 | 0.9996 |
| `BNB-PERP` | 740.67 | `BNBUSDT` | 741.39 | 0.9990 |
| `BTC-PERP` | 82456.1 | `BTCUSDT` | 82545.72 | 0.9989 |
| `CC-PERP` | 0.1208 | `CCUSDT` | 0.1209 | 0.9992 |
| `DOGE-PERP` | 0.08373 | `DOGEUSDT` | 0.08379 | 0.9993 |
| `ETH-PERP` | 2484.56 | `ETHUSDT` | 2485.99 | 0.9994 |
| `HYPE-PERP` | 82.68 | `HYPEUSDT` | 82.762 | 0.9990 |
| `LINK-PERP` | 12.8528 | `LINKUSDT` | 12.856 | 0.9998 |
| `LIT-PERP` | 3.482 | `LITUSDT` | 3.4852 | 0.9991 |
| `PUMP-PERP` | 0.005005 | `PUMPFUNUSDT`, as Bybit has no `PUMPUSDT` | 0.0050093 | 0.9991 |
| `SOL-PERP` | 106.802 | `SOLUSDT` | 106.867 | 0.9994 |
| `VVV-PERP` | 22.788 | `VVVUSDT` | 22.8277 | 0.9983 |
| `XAUT-PERP` | 4165.88 | `XAUTUSDT` | 4171.22 | 0.9987 |
| `XRP-PERP` | 1.35187 | `XRPUSDT` | 1.3529 | 0.9992 |
| `ZEC-PERP` | 1202.29 | `ZECUSDT` | 1202.48 | 0.9998 |

Every ratio lay between 0.9983 and 0.9998 in that run, at 22:39 UTC, and between 0.9982 and 0.9991 in the rerun at 22:41 UTC, where `PUMP-PERP` read 0.005014 against 0.0050190.
Derive's index is in USD and Bybit's in USDT, and the REST index can be seconds old, section 3, which explain gaps of this size.
So every Derive ticker names the token Bybit lists, and `PUMP` is pump.fun, which Bybit calls `PUMPFUN`.
`live_identity` remains the check of record at build time, as decision 15 of the waves design says.

### Routing

No venue in the survey routes to Derive's book, since no other profile under [`docs/profiles/`](../) names Derive or Lyra.
Derive matches every order on its own book, S1, and routes none to another venue.
Front ends may send their users' orders to Derive with a builder fee on top, [`fees.md`](./fees.md) section 5, which adds no second book.

## 10. Source ledger

| id | source | used for |
|---|---|---|
| S1 | [Introduction](https://docs.derive.xyz/getting-started/introduction), retrieved 2026-10-12 | endpoints, the zero-knowledge stack |
| S2 | the OpenAPI file `https://docs.derive.xyz/openapi.json`, version 0.2.0, and [`public/get_all_instruments`](https://docs.derive.xyz/api-reference/market-data/publicget_all_instruments), retrieved 2026-10-12 | methods, params, schemas |
| S3 | [`public/get_tickers`](https://docs.derive.xyz/api-reference/market-data/publicget_tickers) and [Subscriptions](https://docs.derive.xyz/subscriptions), retrieved 2026-10-12 | slim ticker fields |
| S4 | [Perpetuals](https://docs.derive.xyz/perpetuals), retrieved 2026-10-12 | funding, TWAP length, mark clamp |
| S5 | [Perp Funding](https://docs.derive.xyz/perp-funding), retrieved 2026-10-12 | per-hour unit |
| S6 | [Supported Products](https://docs.derive.xyz/supported-products) and [Settlement](https://docs.derive.xyz/settlement), retrieved 2026-10-12 | mark formula, continuous settlement |
| S7 | [Oracles](https://docs.derive.xyz/oracles), retrieved 2026-10-12 | Block Scholes, confidence |
| S8 | [Instrument Names](https://docs.derive.xyz/trading/instrument-names), retrieved 2026-10-12 | name format, universe suffix |
| S9 | [Rate Limits](https://docs.derive.xyz/rate-limits), retrieved 2026-10-12 | budgets, refusal shape |
| S10 | [Migration skill for your coding agent](https://docs.derive.xyz/migrating/breaking-changes) and [DevEx improvements](https://docs.derive.xyz/migrating/v3-improvements), retrieved 2026-10-12 | v2 and v3 hosts, batch states, wallets |
| S11 | [Risk Universes parameters](https://docs.derive.xyz/asset-parameters) and [Risk Universes](https://docs.derive.xyz/risk-universes), retrieved 2026-10-12 | universe table |
| S12 | [Contracts](https://docs.derive.xyz/getting-started/contracts), retrieved 2026-10-12 | chain ids |
| S13 | [New features](https://docs.derive.xyz/migrating/new-features), retrieved 2026-10-12 | risk universes, vaults |
| S14 | [Common Parameters](https://docs.derive.xyz/common-parameters-parameters-that-are-not-specific-to-one-margin-engine-listing-and-settlement-limits-the-oracle-feeds-both-engines-read-and-the-fees-charged-on-trading-and-on-account-creation-per), retrieved 2026-10-12 | `FEED_HEARTBEAT` |
| S15 | [app fee page](https://app.derive.xyz/fees), its embedded announcement feed, retrieved 2026-10-12 | migration date |
| S16 | [Error Codes](https://docs.derive.xyz/error-codes), retrieved 2026-10-12 | `restricted_region` |
| S17 | [Create a Vault](https://docs.derive.xyz/vaults/create-a-vault), retrieved 2026-10-12, as indexed in `https://docs.derive.xyz/llms.txt` | permissionless vaults |
| P1, P2 | [`rest-probe.py`](../../../scripts/probes/venues/derive/rest-probe.py), modes `host`, `catalog`, `anchor`, `errors`, `legacy`, `funding` and `identity`, and [`fees-probe.py`](../../../scripts/probes/venues/derive/fees-probe.py) | every probed value |
| CCXT | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/derive.js` | lines 35, 96, 143, 415, 539, 595, 603 to 606, 615, 633 to 636, 650, 654, 678, 681, 695 and 702 |
