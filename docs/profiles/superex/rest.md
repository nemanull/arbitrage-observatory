# SuperEx REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 02:48 to 03:10 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the REST calls behind the SuperEx USDT-margined perpetuals: catalog, anchor, book and limits.
SuperEx publishes API documentation at `docs-api.superex.com`, but every page of it is titled "Free Market API Docs" and covers only the Free Market spot zone, S1 to S3.
The words "swap", "perpetual" and "futures" appear zero times on its four pages, by [`rest-probe.py`](../../../scripts/probes/venues/superex/rest-probe.py) section "Published API documentation".
Every perpetual call below was found in the web app bundle at `www.superex.live`, S11, and answered on the web app's API base `https://api.superexchang.com`.
The documented base for the Free Market is `https://api.superexchang.com/api`, and the perpetual catalog does not answer under it.
SuperEx has no CCXT class in 4.5.68 or on master, see [`fees.md`](./fees.md) section 8.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| API host | `api.superexchang.com`, the `apiBase` of the web app config, S11 | probe section "DNS" |
| resolved address | 23.213.230.74 and 23.213.230.75, plus two IPv6 addresses, all Akamai | probe section "DNS" |
| request time | 254 to 1,053 ms for the 111 KB catalog over three runs of four calls, with no steady cold penalty | probe section "Perpetual catalog" |
| headers the web app adds | `token` (empty when signed out), `timestamp`, `client: 1`, `nonce`, S11. The catalog answered the same without them. | probe section "Header requirement" |
| main site | `www.superex.com` answered 403 with SuperEx's region page, "your access request was not allowed in your local area network" | probe section "Site access" |
| mirror site | `www.superex.live` answered 200, and its `/en/apiKeyHome` page answered an Akamai 403 "Access Denied" | probe section "Site access" |
| `api.superex.com` | answers `{"code":403,"msg":"Token invalid or expired"}` at its root, and is not the web app's API base | probe section "Site access" |

## 2. Catalog

### The instruments call

`GET https://api.superexchang.com/swap/front/swap` returns every perpetual in one 111,021-byte reply, with no paging.

| field | value on 2026-10-10 |
|---|---|
| contracts | 308 |
| `state` | 1 on all 308. No other value was seen, so the meaning of the others is Not publicly specified. |
| `settlementCurrency` and `quoteCurrency` | `usdt` on all 308 |
| `isDelisting` | 0 on all 308 |
| `contractSize` | 100 on btc_usdt, 10 on the other 307 |
| `ratio` | `0.01` on all 308, meaning Not publicly specified |
| `minVolume` | 1 contract on all 308 |
| other fields | `baseCurrency`, `symbol`, `priceTick`, `maxLeverage`, `minLeverage`, `maxVolume`, `openTime`, `isRank`, `imgs` |

The 308 contracts mix crypto with tokenised equities, ETFs, metals, energy and one currency pair, for example aapl_usdt, tsla_usdt, spy_usdt, xau_usdt, natgas_usdt and usdbrl_usdt.
Some names track unlisted companies, such as unitree_usdt, minimax_usdt and zhipu_usdt.
The catalog has no display name field, so a short ticker such as a_usdt, g_usdt, s_usdt, be_usdt, cl_usdt or gs_usdt does not say which asset it is.

### Mapping without CCXT

No CCXT class exists, so a native loader would map the rows itself.

| engine field | source | note |
|---|---|---|
| `raw_market_id` | `symbol`, for example `btc_usdt` | identical to the socket topic suffix and the socket `symbol` field, [`websocket.md`](./websocket.md) section 3 |
| `base` and `quote` | `baseCurrency` and `quoteCurrency`, upper cased | |
| `linear` | true | USDT-margined, S5 |
| `contract_size` | 1, with the feed converting sizes | `contractSize` is a USDT face value, not a coin amount, see below |
| active | `state` 1 and `isDelisting` 0 | |

### Size unit, pairs listed twice, and price scale

`contractSize` is the face value of one contract in USDT, per S4 and S6, so one contract holds `contractSize / price` coins.
The engine's `contract_size` is a fixed multiplier and cannot carry that, so a feed would convert book sizes to coins itself, as [`websocket.md`](./websocket.md) section 4 describes.
No `baseCurrency` is listed twice.
No contract quotes per 10 or per 1000 units, judging by btc_usdt at about 82,560 and eth_usdt at about 2,491 on the socket.

### Spot catalog, named only

`GET /spot/spot/symbol/config/rules` returns ten rows a page by default with `total` 2147.
With `pageSize=3000` it returned all 2,147 rows, every one with `state` 0.

## 3. Anchor

### The bulk calls

No REST call returns index, mark and funding for every perpetual.
The calls the bundle names were tried:

| call | result from this exit |
|---|---|
| `GET /swap/swap/information/funds-rate?symbol=btc_usdt`, the live funding call | HTTP 403 Akamai "Access Denied" HTML |
| `GET /swap/calc/public/posit-calculi` | HTTP 403 Akamai "Access Denied" HTML |
| `GET /swap/swap/information/funds-rate-page?symbol=btc_usdt&pageNum=1&pageSize=10`, funding history for one symbol | 200, 1,246 bytes, about 230 ms |

The live funding call was refused the same way in every run, and it was not routed around.
What it would return is unknown.

The socket carries all four live anchor fields for every contract, one topic each per symbol, see [`websocket.md`](./websocket.md) section 2.
All 924 topics for the 308 contracts fit on one socket in seven subscribe frames, and every contract had a mark, an index and a funding frame within 15 s.

### Row mapping

| `AnchorRow` column | source | example from the second pass |
|---|---|---|
| index | `swap/index_ticker:<symbol>` `data` | `"82598.7"` on btc_usdt |
| mark | `swap/mark_price:<symbol>` `data` | `"82560"` |
| funding rate | `swap/funding_rate:<symbol>` `data.fundingRate`, a fraction | `"0.0000212134778123"` |
| next settlement | `swap/funding_rate:<symbol>` `data.date`, Unix ms | 1791619200000, which is 2026-10-10 08:00 UTC |
| interval | `fundingTime` in hours on the history call, one call per symbol | 8 on every btc_usdt row |

The server already has a type for this, `SocketAnchors` in `server/src/venues/socket_anchors.rs`, which collects anchor fields from socket frames for venues that publish them only there.
The interval has no socket field, so it would come from 308 history calls at load or from the documented default of 8 hours, which the help center says can differ per pair, S4.

## 4. Anchor semantics

### Index

S8: the USDT index takes trading pairs "from more than five major exchanges for each contract".
It drops an exchange that is under maintenance or stale, converts BTC-quoted pairs with the SuperEx BTC/USDT index, and takes an equal-weighted average of the valid exchanges, or the single remaining one.
The basket members are Not publicly specified, and no basket call was found.

### Mark

The mark formula is Not publicly specified.
S4 uses the mark only inside the premium index.
On the socket, btc_usdt mark sat about 39 USDT under the index during the second pass, 82,560 against 82,598.7.

### Funding

S4: Funding Rate = Premium Index + clamp(0.01% minus Premium Index, 0.05%, -0.05%).
The rate is computed every minute, and the period rate is clamp(8-hour average, fmax, -fmax) with fmax = (initial margin minus maintenance margin) × 75%.
The published rate is the current period one, so the rate applied at 16:00 is the one calculated during the 08:00 to 16:00 period, S4.
The socket's `date` is the next settlement, so the socket rate is the estimate that will settle then.

### The history call and its unit

The six most recent btc_usdt rows settled at 00:00, 08:00 and 16:00 UTC with `fundingTime` 8, for example `fundsRate` `0.0017292` at 2026-10-10 00:00 UTC.
The socket rate at 03:08 UTC was 0.0000212.
The history value is read as a percentage, 0.0017292% or 0.000017292, which puts it on the scale of the socket value.
That reading is an inference from the two scales, and the unit is Not publicly specified.
An unknown symbol returns `{"items": [], "total": 0}` with code 200.
The settlement instant itself was not captured.

### How often each number changed

Over 40 s of socket frames in the second pass:

| field | frames | distinct values |
|---|---|---|
| btc_usdt mark | 22, about 1.9 s apart | 2 |
| eth_usdt mark | 22 | 3 |
| btc_usdt index | 14, about 3.1 s apart | 6 |
| eth_usdt index | 14 | 6 |
| btc_usdt funding | 2, 30 s apart | 2 |


## 5. REST book snapshot

None found.
The bundle names no perpetual depth call, and the book reaches the web app only through `swap/depth:<symbol>` on the socket.
The Free Market documentation lists "Market depth data" and "Order Book" headings with no call under them, S3.
Every socket book frame is a full book, so a REST snapshot is not needed.

## 6. Rate limits and errors

| item | value | label |
|---|---|---|
| published limits | Not publicly specified, in neither the Free Market documentation nor the help center | Not publicly specified |
| limit headers | none on the catalog reply | Probed |
| unknown path | HTTP 200 with `{"code":403,"msg":"Token invalid or expired"}`, the same body a call that needs a login returns | Probed |
| refused call | HTTP 403 with Akamai's "Access Denied" HTML and an `errors.edgesuite.net` reference | Probed |
| documented status codes | 200 OK and 500 Internal Server Error, S1 | Published |

No call in this survey drew a limit, and one run of the REST probe makes 27 calls.

## 7. Server time and clock offset

`GET https://api.superexchang.com/api/common/v3/public/timestamp`, documented in S1, returns `{"code":200,"data":<ms>,"msg":"success"}`.
Local minus server, corrected by half the request time, was -20 ms and -27 ms in two runs.
The `Date` header of the catalog reply agreed within its 1 s resolution.

## 8. Recommended poller shape

No REST anchor poller is recommended.
If the undocumented web backend were accepted, the anchor would be `SocketAnchors` fed from `swap/mark_price`, `swap/index_ticker` and `swap/funding_rate` on the book socket, with the interval read once per symbol from `funds-rate-page`.

The survey verdict for SuperEx is no public API.
SuperEx lists 308 USDT-margined perpetuals, but its only published API covers the Free Market spot zone.
The perpetual catalog, fee schedule, book and anchor topics are the web app's private backend, undocumented and free to change, which is the standing that gave Coinstore and Bitbaby the same verdict in [`../../research/2026-09-22-venue-survey.md`](../../research/2026-09-22-venue-survey.md).
That backend is technically complete: one socket carries every book and every anchor field, and the catalog and fees are one call each.
Adopting it would take four named changes: a native catalog loader, a Base64 then gunzip frame decoder, a per-level size conversion by price, and a rule for books that flicker empty.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [Quick Start, Free Market API Docs](https://docs-api.superex.com/en/quickStart.html) | 2026-10-09 |
| S2 | [Websocket Free Market Quotes Data](https://docs-api.superex.com/en/websocket.html) | 2026-10-09 |
| S3 | [Market situation, Free Market API Docs](https://docs-api.superex.com/en/Market.html) | 2026-10-09 |
| S4 | [Introduction to Perpetual Funding Fee Rules](https://support.superex.com/hc/en-001/articles/44457052286361), updated 2025-11-27 | 2026-10-09 |
| S5 | [Introduction to Perpetual Futures](https://support.superex.com/hc/en-001/articles/4412869144217), updated 2025-03-07 | 2026-10-09 |
| S6 | [USDT-Margined Futures Account Equity and P&L Calculation](https://support.superex.com/hc/en-001/articles/44462213199129), updated 2025-03-13 | 2026-10-09 |
| S8 | [Index Calculation Rules](https://support.superex.com/hc/en-001/articles/44457340458009), updated 2025-03-13 | 2026-10-09 |
| S11 | The web app at [www.superex.live](https://www.superex.live/), its `window.__NUXT__.config` with `apiBase` `https://api.superexchang.com`, and its `/_nuxt/` chunks holding the `/swap/` paths | 2026-10-09 |
