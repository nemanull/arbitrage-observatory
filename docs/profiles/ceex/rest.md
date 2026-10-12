# CEEX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
CEEX publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The calls below are the BlueHelix OpenAPI paths the platform still serves, and the `/api/v3/triggerContract/` paths the site's own bundle calls for the live perpetuals.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/ceex/rest-probe.py), cited as R with a section number, and from [`ws-probe.py`](../../../scripts/probes/venues/ceex/ws-probe.py), cited as W.

## 1. Host and latency from this machine

| host | resolved on 2026-10-09 | role | result |
|---|---|---|---|
| `www.ceex.com`, `api.ceex.com`, `wsapi.ceex.com` | `47.57.180.133`, `8.212.17.30` | the site, both REST families and the sockets | HTTP 200, and `wsapi` answers 503 on `/` but serves the quote socket, R1, W8 |
| `ceex.com`, `static.ceex.com` | CloudFront addresses in `143.204.1.0/24` | the site shell and images | HTTP 200, R1 |
| `www.ceexcloud.com` | `8.211.169.88`, `8.216.45.71` | a mirror domain the bundle names | not probed beyond DNS |
| `www.ceexs.com` | four addresses in `206.238.32.0/24` | a mirror domain the bundle names | not probed beyond DNS |
| `openapi.ceex.com` | does not resolve | | R1 |

`GET /openapi/v1/time` took 728 to 807 ms over four tries in each of two runs, with no gap between cold and warm, R2.
The probe opens a new TLS connection for every request, which is most of that time.
Small replies took 727 to 901 ms, and the 25 KB perpetual catalog took 902 to 963 ms, R3.
No geoblock or challenge was seen on any call from this Canadian exit.

## 2. Catalog

### The live perpetual catalog

`GET https://www.ceex.com/api/v3/triggerContract/system/getContractConfigAllList` returns `{"code":"200","msg":"Success","data":[...]}`, 25,294 bytes, R3.

| item | value |
|---|---|
| rows | 11 |
| `enabledState` and `tradingState` | 1 on every row |
| symbols | BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, DOTUSDT, SUIUSDT, UNIUSDT, LINKUSDT |
| settlement asset | USDT on every row, implied by the symbol, since no field names it |
| symbol spelling | base and quote with no separator, `BTCUSDT`, the string the socket channels use, see [`websocket.md`](./websocket.md) section 2 |
| quantity unit | base asset: `minOrderQuantity` 0.001 and `minStepQuantity` 0.001 on BTCUSDT, 100 and 1 on DOGEUSDT |
| leverage | `maxLeverage` 150 on BTC and ETH, 125 on XRP, 100 on SOL, 75 on the rest |
| margin tiers | `positionTiersConfigList`, ten tiers per contract and nine on SUIUSDT |
| other fields | `pricePrecision`, `quantityPrecision`, `priceLimitRate` 50, `fundingFeeRate` empty, `fundingInterval` 0, `slippageConfigList` null |

The site config at `/s_api/basic/config_v2_js` repeats the same eleven rows as `contractSymbols`, R3.
`GET /api/v3/triggerContract/system/getContractConfigBySymbol?symbol=BTCUSDT` returns one row, and an unknown symbol returns `{"code":-1,"msg":""}` with HTTP 200, R3.
No pair is listed twice.

### How CCXT maps it

No CCXT class exists, so there is no `market.id`, `contractSize`, `linear` or `active` to compare.
An adapter builds its own catalog from this call, with `symbol` as the raw market id, contract size 1 because book sizes are in base units, and linear true.

### The legacy BlueHelix swaps

`GET /openapi/v1/brokerInfo` lists 9 `contracts`, all `status` TRADING, all USDT-margined and not inverse, R4.
They are `BTC-SWAP-USDT`, `ETH-SWAP-USDT`, `BCH-SWAP-USDT`, `XRP-SWAP-USDT`, `LTC-SWAP-USDT`, `TRX-SWAP-USDT`, `ETC-SWAP-USDT`, `LINK-SWAP-USDT` and `XLM-SWAP-USDT`, with `contractMultiplier` from 0.0001 (BTC) to 1.0 (TRX, XLM).
They are not live markets:

| check | BTC-SWAP-USDT | ETH-SWAP-USDT |
|---|---|---|
| book, `/openapi/quote/v1/contract/depth` | 14 bids from 64,886.2 down to 0.2, no asks | 5 bids and 1 ask, 1,528 against 2,629 |
| newest of 61 trades, `/openapi/quote/v1/contract/trades` | 2026-03-19 11:16:55 UTC | 2026-06-03 20:54:50 UTC |
| 24 h volume, `/openapi/quote/v1/contract/ticker/24hr` | 0 | 0 |

The announcements list a contract system upgrade on 2026-03-02, see [`fees.md`](./fees.md) S6, which fits the BTC swap's last trade.
The legacy swaps are named here for the coverage matrix and not profiled further.

### Spot, for the coverage matrix

`/openapi/v1/brokerInfo` lists 170 spot symbols, all `status` TRADING, and `/openapi/quote/v1/ticker/price` returns 170 rows, R4, R7.
The spot pair `BTCUSDT` has the same name as the perpetual `BTCUSDT`, so the two catalogs must not be mixed.

## 3. Anchor

No single call returns the anchor for the live perpetuals.
The socket ticker `TRIGGER_CONTRACT_TICKER_ALL` carries mark, funding rate and next settlement for all eleven contracts every 200 ms, see [`websocket.md`](./websocket.md) section 2.

| `AnchorRow` column | source | value seen | label |
|---|---|---|---|
| index | none for these contracts. The legacy call `GET /openapi/quote/v1/contract/index` returns 22 `index` and 22 `edp` keys, which cover BTC, ETH, XRP, ADA, DOT, UNI and LINK but not SOL, DOGE, AVAX or SUI. | BTCUSDT 82,669.4 in R5 | Probed, not documented as the index of these contracts |
| mark | socket ticker `markPrice` | BTCUSDT 82,671.17 beside last 82,670.95 in W5 | Probed |
| funding rate | socket ticker `fundingRate` | exactly 0.00010 or -0.00010 on every contract in every run, with the sign flipping between runs on XRPUSDT, AVAXUSDT and DOGEUSDT | Probed |
| interval | none. The catalog's `fundingInterval` is 0 on every row. | | Not publicly specified |
| next settlement | socket ticker `nextFundingTime` in ms | 2026-10-10 08:00:00 UTC on every contract | Probed |

The site's REST calls for price and funding, `/api/v3/triggerContract/pageCalculate/getPriceAndFundingRate` and `/getCurrentPrice`, answer `{"code":30000,"msg":"Authentication failed, login again"}` without a session, R5.
`/api/contract/history_funding_rates?tokenId=BTCUSDT` answers 500 with code 30001, and `/openapi/quote/v1/markPrice` answers 200 with an empty body, R5.
The legacy funding calls only cover the dead swaps.
`/openapi/contract/v1/fundingRate` returns one row, `BTC-SWAP-USDT` at -0.003 for 04:00 to 12:00 UTC, and `/api/contract/funding_rates` returns the nine legacy swaps with 0 on eight of them, R4.

## 4. Anchor semantics

No index formula, basket, mark formula, funding formula or cap is published.
`markPrice` stayed within one or two ticks of the last price `c` on every contract, such as 0.22 USD on BTCUSDT and 0 on most others in W5.
Over 75 s of 200 ms frames, BTCUSDT `markPrice` changed 54 times and `c` 8 times, while `fundingRate` and `nextFundingTime` never changed on any contract, W5.
The ticker field `refPrice` is `"0"` on every row.
Whether `fundingRate` is the upcoming or the last settled rate is not stated.
The settlement instant itself was not captured, because the survey does not wait for clock events.

## 5. REST book snapshot

No public REST book exists for the live perpetuals.
`GET /openapi/quote/v1/depth?symbol=BTCUSDT&limit=100` returns the spot book: in R6 it gave best bid 82,660.12 and ask 82,676.66, with bids descending and asks ascending, while the perpetual book on the socket a minute earlier stood near 82,630, W2 in the first run.
`/api/quote/v1/depth?symbol=301.BTCUSDT` is the same spot book in the site's format, R6.
No cache header was seen on either.
The socket's full book every 200 ms makes a REST snapshot unnecessary, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

`/openapi/v1/brokerInfo` declares `REQUEST_WEIGHT` 3,000 per minute and `ORDERS` 60 per 60 s, R4.
No reply carried a rate limit header or `Retry-After`, and no limit was hit, R7.

| call | status | body |
|---|---|---|
| `/openapi/quote/v1/depth?symbol=NOPEUSDT` | 400 | `{"code":-100011,"msg":"Not supported symbols"}` |
| `/openapi/quote/v1/depth` with no symbol | 400 | `{"code":-100012,"msg":"Parameter symbol [String] missing!"}` |
| `/api/v3/triggerContract/system/getContractConfigBySymbol?symbol=NOPEUSDT` | 200 | `{"code":-1,"msg":""}` |
| `/api/v3/triggerContract/system/nope` | 404 | a Spring Boot `{"timestamp":…,"status":404,"error":"Not Found","path":…}` |
| an account call without a session | 200 or 400 | `{"code":30000,"msg":"Authentication failed, login again"}` |

## 7. Server time and clock offset

`GET /openapi/v1/time` returns `{"serverTime":1791607796277}` in ms.
`serverTime` fell 253 to 294 ms after the midpoint of each request over two runs, R2.
Each request spent its first part on a new TCP and TLS handshake, so the server stamps late in the window, and no offset beyond that can be read from these numbers.
The `Date` header read 0.2 to 0.6 s behind the host clock, within its one second truncation, R2.

## 8. Recommended poller shape

- Catalog: `getContractConfigAllList` at startup and on refresh, keeping rows with `enabledState` 1 and `tradingState` 1.
- Anchor: no REST poller works, because mark and funding are only on the socket.
  The adapter takes mark, funding rate and next settlement from `TRIGGER_CONTRACT_TICKER_ALL` through the server's socket anchors, see [`../../../server/src/venues/socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs).
- Index: the legacy `/openapi/quote/v1/contract/index` gives a number for seven of the eleven contracts in one reply of about 1 KB, and nothing for SOLUSDT, DOGEUSDT, AVAXUSDT and SUIUSDT.
  Whether those seven numbers are the reference these contracts use is not documented.
- Interval: not published, so the row needs a fixed value or a value derived from successive `nextFundingTime` changes.
- Skip the legacy `*-SWAP-USDT` swaps.

## 9. Source ledger

| id | source | retrieved | what it gave |
|---|---|---|---|
| R | [`rest-probe.py`](../../../scripts/probes/venues/ceex/rest-probe.py) | 2026-10-09 | every REST number above |
| W | [`ws-probe.py`](../../../scripts/probes/venues/ceex/ws-probe.py) | 2026-10-09 | mark, funding and book values from the socket |
| B | `https://www.ceex.com/static/js/main.590e5384.chunk.js` | 2026-10-09 | the `/api/v3/triggerContract/` paths, among them `contract_list` and `contract_getLatestPriceAndFee` |
