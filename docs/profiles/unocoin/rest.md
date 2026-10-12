# Unocoin REST Profile

**Status:** Done.
The futures REST surface is undocumented and was read from the unocoin.com web app bundle.
It has a catalog, a bulk call with mark and funding but no index or next settlement, and a REST book.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:13 to 04:26 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada, and every reply carried a `YVR` (Vancouver) Cloudflare ray id.

Unocoin lists perpetuals, so this profile covers them.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/unocoin/rest-probe.py), whose second pass run, 04:24 to 04:26 UTC, is the one cited unless a line says otherwise.
Socket numbers come from [`ws-probe.py`](../../../scripts/probes/venues/unocoin/ws-probe.py).
Fees are in [`fees.md`](./fees.md) and the socket is in [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

- Base URL: `https://api.unocoin.com/api`, hard coded in the web app bundle, S1.
- `api.unocoin.com`, `pi42-stream.unocoin.com` and `unocoin.com` all resolve to Cloudflare `104.18.10.81`, `104.18.11.81`, `2606:4700::6812:a51` and `2606:4700::6812:b51`.
- Replies carry `server: cloudflare`, `x-powered-by: PHP/8.3.8`, `tz: Asia/Kolkata`, `cache-control: no-cache, private` and `access-control-allow-origin: *`.
- `GET /v1/futures/market/ticker24Hr/BTCINR`: cold 824 ms, warm median 884 ms, warm max 1,930 ms over five warm calls a second apart.
  The first run gave cold 453 ms, warm median 971 ms and warm max 3,185 ms.
- Access from the Canadian exit: every call in this profile answered, and nothing returned a geoblock, a Cloudflare challenge or a refusal.
  The only non-200 answers were the `404` and `422` replies to wrong paths and unsupported symbols, section 6.

## 2. Catalog

### The instruments call

`GET /v1/futures/app-pairs` returns `{"markets":["INR"],"contracts":[...],"assetPrecisions":{...}}`, 20,529 bytes.

| field | value on the 14 contracts |
|---|---|
| `contract_type` | `PERPETUAL` on 14 |
| `status` | 1 on 14, rendered "Enabled" by the fee page, see [`fees.md`](./fees.md) section 2 |
| `quote_asset`, `market` | `INR` on 14 |
| `margin_assets_supported` | `["INR"]` on 14 |
| `funding_fee_interval` | 8 on 14 |
| `max_leverage` | 150, 100, 75, 50 or 40 |
| `unocoin_max_leverage` | 5 on 14 |
| `depth_grouping` | one value per contract, such as `["0.1"]` on BTCINR |
| `quantity_precision`, filters | quantity step in base coin, such as `minQty` 0.001 BTC and `MIN_NOTIONAL` 11011.25 INR on BTCINR |

The 14 symbols are BTCINR, ETHINR, SOLINR, XRPINR, DOGEINR, HBARINR, TRXINR, BCHINR, ZECINR, LTCINR, SUIINR, BNBINR, XLMINR and ADAINR.
The support article lists LINEA-INR as well, and the catalog does not, see [`fees.md`](./fees.md) section 4.
No base asset is listed twice.

The bulk call `GET /v1/futures/market/marketInfo` carries more rows than the catalog: 216 in the first run and 246 in the last reply of the second.
These are the Pi42 deployment's other INR contracts, such as SANDINR.
Unocoin's REST book, ticker and socket refuse them, section 6 and [`websocket.md`](./websocket.md) section 4.
So the catalog of 14 is what Unocoin serves.

### How CCXT 4.5.68 maps it

There is no CCXT class, see [`fees.md`](./fees.md) section 8.
A native catalog loader would read `app-pairs` and keep `contract_type` `PERPETUAL` with `status` 1.

- `market.id`: `symbol`, such as `BTCINR`, equal to `data.s` on the socket and to the `marketInfo` key.
  The socket channel spells it in lower case.
- `base`: `base_asset`, `quote`: `INR`, `linear`: true, settled in INR.
- `contractSize`: 1, since book sizes and the quantity step are in base coin, see [`websocket.md`](./websocket.md) section 4.
- `active`: `status` 1.

### Size unit, pairs listed twice, and price scale

Sizes are base coin.
No pair is listed twice, and no contract is quoted per 10 or per 1000 units.
INR is not in the engine's USD quote family, so no contract would cluster with another venue without an INR rate, see section 8.

## 3. Anchor

### The bulk call

`GET /v1/futures/market/marketInfo` returns one object keyed by symbol.
Three calls a second apart gave 39,429, 39,449 and 44,874 bytes in 4,698, 2,484 and 1,106 ms.
Each row has exactly `lastPrice`, `marketPrice`, `upcomingFundingRate`, `priceChangePercent`, `baseAssetVolume` and `quoteAssetVolume`.
All 14 catalog symbols were present in every reply.

```json
{"BTCINR":{"marketPrice":"7911660","upcomingFundingRate":"0.000016398","priceChangePercent":"0.260","baseAssetVolume":"97672.220","quoteAssetVolume":"773681381356","lastPrice":"7911603"}}
```

No REST call returns the index or the next settlement time.
The paths `/v1/futures/market/fundingRate`, `/premiumIndex`, `/markPrice/BTCINR`, `/fundingRateHistory/BTCINR` and `/indexPrice/BTCINR` all answer `404` with `"The route ... could not be found."`.
The web app bundle calls no other public futures market path than those in this profile, S1.

The socket's `<symbol>@markPrice` channel carries all of them per contract, once a second, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | source | field |
|---|---|---|
| `index` | socket only | `i` of `<symbol>@markPrice` |
| `mark` | REST bulk | `marketPrice` |
| `funding_rate` | REST bulk | `upcomingFundingRate` |
| `funding_interval_hours` | catalog | `funding_fee_interval`, 8 on all 14 |
| `next_funding_at` | socket only | `T` of `<symbol>@markPrice`, such as 1791619200000, 08:00 UTC |
| `ts` | none on REST | the socket's `E` |

## 4. Anchor semantics

Unocoin publishes no index, mark or funding formula.
What follows is what the wire shows.

### Index

The support article says the index is "Derived from major spot exchanges (may show -- for some pairs)", S2.
On the wire `i` is an INR number, 7916594 on BTCINR at 04:26:07 UTC.
Divided by the contract's rate of 95.75 it is 82680, close to Binance's BTCUSDT index of 82665.53 read by REST about two minutes earlier.
The basket is not published.

### Mark

- `p` over the socket's `ap` was exactly 95.7500 on BTCINR on the last mark frame of each socket run, and `ap` is on the USDT scale.
- REST `marketPrice` over Binance's BTCUSDT `markPrice`, read seconds apart, was 95.7501 in both runs.
- So the mark is Binance's mark times the contract's INR rate.
  No clamp is published.

### Funding

- `upcomingFundingRate` is the rate for the next settlement, by its name and by the socket, where `r` equals it and `T` is the next 8 h boundary.
- In each run's comparison call BTCINR read 0.000016398, against Binance's BTCUSDT predicted `lastFundingRate` of 0.00001845 in the first run and 0.00001773 in the second, ratios of 0.89 and 0.92.
- BTCINR's rate then changed to 0.000015957 during the second run's polls.
- The socket's undocumented `lr` read 0.000048078, which is 0.92 of Binance's last settled BTCUSDT rate 0.00005232 at 1791590400002.
  It may be Unocoin's last settled rate, and that is not confirmed.
- The next settlement `T` equalled Binance's `nextFundingTime`, 1791619200000.
- No cap or floor is published.
  The settlement instant was not captured.

### How often each number changed

Eighteen polls of `marketInfo` over 60 s, one every 2 s plus the reply time:

| field | changes | distinct values |
|---|---|---|
| `marketPrice` | 10 | 10 |
| `upcomingFundingRate` | 1 | 2 |
| `lastPrice` | 4 | 5 |

The socket's `markPrice` channel updates every 1,000 ms, which is faster than the REST call returns.

## 5. REST book snapshot

`GET /v1/futures/market/depth/<symbol>` returns the same Binance-shaped window as the socket:

- 969 bytes, 20 bids and 20 asks, both ascending by price, with `ps` `BTCUSDT` and Binance's `U`, `u` and `pu`.
- `?limit=5` is ignored and still returns 20 levels.
- A lower case symbol works.
- Two calls 0.3 s apart returned different `u`, so the reply is not cached for that long.
- `GET /v1/futures/market/aggTrade/BTCINR` returns 50 trades, and `GET /v1/futures/market/ticker24Hr/BTCINR` a Binance `24hrTicker` in INR.
- The ticker's `E` was 2,673 ms behind the local clock in the first run and 4,347 ms in the second, so the REST ticker is seconds old.

## 6. Rate limits and errors

- Unocoin publishes no futures rate limit, and no reply carries a rate limit or `Retry-After` header.
  No `429` was seen at about one request a second.
- A Pi42 contract outside Unocoin's catalog, or an unknown symbol, answers `422`:

```json
{"error":{"message":"422 Unprocessable Content","errors":{"contractPair":["Currently, we are not supporting this trading pair."]},"status_code":422}}
```

- A wrong path answers `404` with `{"error":{"message":"The route api/v1/futures/market/fundingRate could not be found.","status_code":404}}`.

## 7. Server time and clock offset

No server time call was found.
The `Date` header gave a median offset of -0.17 s at one second resolution, and +0.22 s in the first run.

## 8. Recommended poller shape

Not recommended.
Unocoin's perpetuals relay Binance USD-M through Pi42 at a fixed per-contract INR rate.
The book is Binance's depth20@100ms, one frame in five, about 190 ms late, and the mark, next funding time and size are Binance's, with funding near 0.9 of Binance's.
As a leg it adds no independent price, so only relay lag or the INR rate could produce a cross.
Four more gaps stand on top of that.

- Every contract is quoted and settled in INR, outside the engine's USD quote family.
- The venue has no CCXT class and no public API documentation, so catalog, socket and anchor are all undocumented web app calls.
- REST has no index and no next settlement, which only the per-symbol socket channel carries.
- Only Indian residents may trade, see [`fees.md`](./fees.md) section 1.

If it were built anyway, the poller would read `GET https://api.unocoin.com/api/v1/futures/market/marketInfo` every 5 s for `marketPrice` and `upcomingFundingRate`, keep only the 14 catalog symbols, take the interval from `funding_fee_interval`, and take `index` and `next_funding_at` from `<symbol>@markPrice` on the book socket.

## 9. Source ledger

| id | source | label |
|---|---|---|
| S1 | unocoin.com web app bundle, chunks `3498-03134daf8521dab0.js`, `9437-65f2bac530810e9e.js`, `_app-58534108c9b9baec.js` and the futures page chunk, downloaded 2026-10-10 | Published, undocumented |
| S2 | [Unocoin support, "How to Trade Futures"](https://support.unocoin.com/portal/en/kb/articles/how-to-trade-on-futures-27-4-2026), retrieved 2026-10-10 | Published |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/unocoin/rest-probe.py), two runs on 2026-10-10 | Probed |
| P2 | Binance USD-M `GET https://fapi.binance.com/fapi/v1/premiumIndex` and `/fapi/v1/fundingRate` for BTCUSDT, in `rest-probe.py` | Probed |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/unocoin/ws-probe.py) | Probed |
