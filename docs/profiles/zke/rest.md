# ZKE REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:02 to 04:35 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures REST API of ZKE, which has no CCXT class, see [`fees.md`](./fees.md) section 8.
Every claim below was captured by [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) in two runs unless a source id says otherwise.
Source ids are shared with [`fees.md`](./fees.md) and [`websocket.md`](./websocket.md).
The short answer is that ZKE is a ChainUp white label whose catalog, contract config, `/index` call and book socket match what the engine's ChainUp family adapter already reads, with the `E-BTC-USDT` spelling that adapter expects.
No REST call returns the anchor for every contract at once.

## 1. Host and latency from this machine

### Where the API lives

ZKE publishes its own API document at `help.zke.com/api_en`, which names `https://openapi.zke.com` for spot and `https://futuresopenapi.zke.com` for futures, S12 and S13.
The site's web config names the futures web host `https://futures.zke.com` as `coUrl`, the spot socket `wss://ws.zke.com/kline-api/ws` as `wsUrl`, and links the ChainUp Open API v2 document as `openApiDocUrl`, S15.
The home page loads `chainupcloud.com` scripts and serves assets from a `/1714/` path, which marks the white label, S17.

### Access, from the Canadian VPN exit

| request | status | reply |
|---|---|---|
| `GET https://www.cloudflare.com/cdn-cgi/trace` | 200 | `loc=CA`, `colo=YVR`, exit 149.22.81.161 |
| `GET https://www.zke.com/` | 200 | the web app, `server: webserver`, after a 302 to `/en_US` for a client that does not follow redirects |
| `GET https://futuresopenapi.zke.com/fapi/v1/ping` | 200 | `{}` |
| `GET https://openapi.zke.com/sapi/v1/ping` | 200 | `{}` |
| `GET https://openapi.zke.com/` | 404 | a Spring `Not Found` JSON body |
| `POST https://futures.zke.com/fe-co-api/common/public_info` | 200 | the futures web list, given the `exchange-language` header, section 2 |
| `GET https://futuresopenapi.zke.com/v1/inner/contract_config` | 200 | the contract config, section 2 |
| `GET https://pages.zke.com/en_US/fees` | 200 | the fee page, see [`fees.md`](./fees.md) |
| `wss://futuresws.zke.com/kline-api/ws` | 101 | see [`websocket.md`](./websocket.md) section 1 |

Nothing was refused, no reply carried a region message, and a request with no `User-Agent` header got 200 as well.

### Resolution

| host | resolved on 2026-10-10 |
|---|---|
| `futuresopenapi.zke.com`, `openapi.zke.com`, `futuresws.zke.com` | `35.78.139.104` and `52.195.57.47`, through the CNAME `cloong-alb-internet-h5-v6-1615804683.ap-northeast-1.elb.amazonaws.com`, an AWS load balancer in Tokyo |
| `www.zke.com`, `zke.com`, `futures.zke.com` | `18.180.231.122` and `52.68.126.219`, another AWS load balancer in Tokyo |
| `ws.zke.com` | `15.197.239.171` and `3.33.194.165`, AWS Global Accelerator |
| `support.zke.com`, `pages.zke.com` | `154.53.59.141` |
| `help.zke.com` | Cloudflare, a GitBook host |
| `api.zke.com` | no address |

[`../czr/rest.md`](../czr/rest.md) section 1 and [`../idax/rest.md`](../idax/rest.md) section 1 found the same two addresses and CNAME for their `openapi` hosts, so one ChainUp load balancer serves several tenants, which is an inference.

### Latency

| call | first request | warm requests |
|---|---|---|
| `GET /fapi/v1/time` | 408 and 474 ms in two runs | 396 to 467 ms over ten reads, median 431 and 416 ms |
| `GET /fapi/v1/contracts`, 153 KB | 1,959 and 1,746 ms | |
| `GET /v1/inner/contract_config`, 141 KB | 1,192 and 1,300 ms | |
| `POST /fe-co-api/common/public_info`, 321 KB | 962 and 937 ms | |
| `GET /fapi/v1/index`, one contract | | median 439 and 446 ms over two rounds of 209 calls |

Every call crosses the Pacific to Tokyo, which sets the floor near 400 ms.

## 2. Catalog

### The instruments call

`GET https://futuresopenapi.zke.com/fapi/v1/contracts` returned 304 rows in 152,817 bytes in both runs, P3.

| field | values on 2026-10-10 | meaning, S13 |
|---|---|---|
| `symbol` | `E-BTC-USDT`, `E-BTC-USD`, `S-BTC-USDT` and so on | the contract name |
| `type` | E on 303, S on 1 | E perpetual, S simulated, by the ChainUp convention |
| `side` | 1 on 291, 0 on the 13 `-USD` rows | read here as linear and inverse |
| `status` | 1 on 217, 0 on 87 | 1 can trade |
| `marginCoin` | USDT on 290, the base coin on the 13 inverse rows, `EXUSD` on `S-BTC-USDT` | |
| `multiplier` | on the 209 trading USDT rows, 0.01 on 90, 1 on 47, 0.1 on 18, 100 on 12, 5 on 12, 10 on 10, and others | "Contract face value", in units of `multiplierCoin`, 0.0001 BTC on `E-BTC-USDT` |
| fees | `openTakerFee` 0.00075 and `openMakerFee` 0.00025 on all 304 | see [`fees.md`](./fees.md) section 2 |

209 rows have `type` E, `side` 1, `status` 1 and `marginCoin` USDT, all quoted in USDT.
No base is listed twice, and every `multiplierCoin` appears in its `symbol`.
7 inverse rows trade, at 10 USD a contract, and they are out of scope here.

### The web list and the contract config

Two more calls list the contracts with their funding interval.

| call | rows | what it adds |
|---|---|---|
| `POST https://futures.zke.com/fe-co-api/common/public_info` | 213, the 205 USDT perpetuals, 7 inverse and `S-BTC-USDT` | `subSymbol` (`e_btcusdt`), `capitalFrequency`, `nextCapitalSettTime`, `capitalIntervalMax`, `assetClass`, `feeRateVo`, and `wsUrl` |
| `GET https://futuresopenapi.zke.com/v1/inner/contract_config` | the same 213 | `capitalFrequency`, `capitalPremiumMax` and `status` 1 on every row, no `subSymbol` and no next settlement |

The web list answers `{"code":"200004","msg":"parameter illegal"}` to an empty body with no `exchange-language` header, and the full list with `exchange-language: en_US`, P3.
The engine's `Schedule::PublicInfo` posts `{}` with no such header, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 160, so it would fail here as it does on idax and CZR.
The contract config needs no header, and its `capitalFrequency` equals the web list's on all 213 rows, P3.
So `Schedule::ContractConfig` fits ZKE.
The adapter derives the raw id from `contractName` when a row has no `subSymbol`, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 178, which gives `e_btcusdt`.

### What the schedule join drops

The open API lists four trading USDT contracts that neither the web list nor the contract config holds: `E-ACH-USDT`, `E-BEL-USDT`, `E-BSV-USDT` and `E-LUNA-USDT`, in both runs, P3.
Each is broken in another way, P4 and P5.

| contract | mark | index | book |
|---|---|---|---|
| `E-BEL-USDT` | 0.5057 | 0.1241 | two sided |
| `E-ACH-USDT` | 0.0207 | 0.0058 | two sided |
| `E-BSV-USDT` | 53.48 | 19.0 | one bid, no ask |
| `E-LUNA-USDT` | 0.0432 | 0.0476 | empty |

The adapter keeps a contract only when the schedule lists it too, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 53 to 54 and 86 to 90, so these four drop out with no profile entry.
The other 205 all had a ticker time within the last day and a nonzero 24 h volume on `GET /fapi/v1/ticker_all`, P3.

### Asset classes

Of the 205 scheduled perpetuals, the web list's `assetClass` is 1 on 125, 2 on 74, 3 on 4 and 5 on 2, P3.
Class 2 holds US and Asian equities, ETFs such as `SPY`, `QQQ` and `UVXY`, and pre-IPO names `ANTHROPIC`, `OPENAI` and `SPCX`.
Class 3 is `XAU`, `XAG`, `XPT` and `COPPER`, and class 5 is `CL` and `BZ`.
The site markets these as an RWA zone, S2 in [`fees.md`](./fees.md).

### Symbol spellings

| where | BTC contract |
|---|---|
| REST `contracts`, `index`, `depth`, `ticker`, the contract config | `E-BTC-USDT`, and `depth` also accepts `e-btc-usdt` |
| web list `subSymbol`, `ticker_all` keys, and the socket channel | `e_btcusdt` |
| web list `symbol` | `BTC-USDT`, which REST refuses with `-1121` |
| `e_btcusdt` on REST | refused with `-1121` |

The engine keys the market on the socket spelling and derives it from the REST name, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 131 to 139, and that rule matched `subSymbol` on all 213 web rows, P3.

### How CCXT maps it

It does not, because CCXT has no ZKE class.
The engine's ChainUp adapter reads `/contracts` itself, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 26.
It keeps a row only when `type` is E, `side` is 1 and `status` is 1, at line 62, and only when `marginCoin` equals the quote, at line 70.
All 209 trading USDT rows pass both checks, and the schedule join then keeps 205.
The size comes from `multiplier`, at line 100.

### Size unit and price scale

Book sizes on REST and on the socket are whole numbers of contracts, and one contract is `multiplier` coins, see [`websocket.md`](./websocket.md) section 4.
Two contracts quote a price per 1,000 tokens.
`E-PEPE-USDT` had an index of 0.004037 when Gate's PEPE index was 0.000004036, a ratio of 1,000.2, and `E-SHIB-USDT` a ratio of 999.9, P4.
Their multipliers are 500 and 100, so a contract counts bundles of 1,000 tokens, which is an inference that mirrors Koinbay's.
They need `price_scales` of 0.001, as Koinbay has at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 161.
Every other contract shared with Gate sat within 6,000 ppm of Gate's index, except `E-ANTHROPIC-USDT`, section 4.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| socket `mark_price_<sub>` | `indexPrice` | `tagPrice` | `currentFundRate` and `nextFundRate` | absent | `nextSettlementTime`, Unix ms | one contract, but the frames stall on busy sockets, see [`websocket.md`](./websocket.md) section 2 | pushed |
| `GET /fapi/v1/index?contractName=E-BTC-USDT` | `indexPrice` | `tagPrice` | `currentFundRate` and `nextFundRate` | absent | absent | one contract | median 439 and 446 ms |
| `GET /v1/inner/contract_config` | absent | absent | absent | `capitalFrequency`, hours | absent | 141 KB, 213 rows | 1,192 and 1,300 ms |
| `POST /fe-co-api/common/public_info` | absent | absent | absent | `capitalFrequency`, hours | `nextCapitalSettTime`, Unix ms | 321 KB, 213 rows | 962 and 937 ms |

No REST call returns index, mark and funding for every contract at once.
`/fapi/v1/index` requires `contractName`, and one round over 209 contracts, four at a time, took 24,940 and 24,983 ms in two runs, P4.
At 24 in flight, as the engine sweeps FameEX at [`anchor.rs`](../../../server/src/venues/chainup/anchor.rs) lines 22 to 24, the same round would take about 4 s from here, which is an estimate from the median call time.
The socket's `nextSettlementTime` equalled the web list's `nextCapitalSettTime` on 205 of 205 contracts in both runs, P8.

ZKE's document shows an `index` reply of `markPrice`, `indexPrice`, `lastFundingRate`, `contractName` and `time`, S13.
The wire carried `currentFundRate`, `tagPrice`, `indexPrice` and `nextFundRate` on all 209, P4.
The document also spells the host `futuersopenapi.zke.com` for this one call, S13, a typo that does not resolve.

The BTC reply at 04:21 UTC, as the probe printed it after parsing:

```json
{"currentFundRate": 3.9e-05, "tagPrice": 82650, "indexPrice": 82688.31666666667, "nextFundRate": 3.9e-05}
```

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the raw id, `e_btcusdt`, from the socket channel or the schedule row | string | none |
| `index` | `indexPrice` | JSON number on REST, decimal string on the socket | parse |
| `mark` | `tagPrice` | the same | parse |
| `fundingRate` | `currentFundRate` | fraction per period | parse |
| `fundingIntervalHours` | `capitalFrequency` of the contract config | hours, 8, 4 or 1 | none |
| `nextFundingAt` | `nextSettlementTime` on the socket, `nextCapitalSettTime` on the web list | Unix ms | parse |

The socket mapping is `AnchorSource::MarkPrice`, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 58, and the REST one is `AnchorSource::Rest`, at line 59.
The REST sweep takes the next settlement from the schedule, at [`anchor.rs`](../../../server/src/venues/chainup/anchor.rs) line 221, and the contract config carries none, so a REST anchor with `Schedule::ContractConfig` leaves `nextFundingAt` unknown.

## 4. Anchor semantics

### Index

ZKE publishes no index page that this research found, so the formula and basket are Not publicly specified, S10 in [`fees.md`](./fees.md).
No basket call is public.
Against one read of Gate's public USDT perpetual index, S16, the ZKE index was within 1,000 ppm on 166 and 171 of 206 shared contracts in two runs, with a median gap of 353 and 326 ppm, P4.
Three were beyond 10,000 ppm in both runs: `E-PEPE-USDT` and `E-SHIB-USDT`, for the price scale of section 2, and `E-ANTHROPIC-USDT`, at 21,297 and 21,757 ppm, a pre-IPO name whose reference can differ between venues.
The next widest were under 9,000 ppm in the first run and under 6,000 ppm in the second.
The BTC index read `82682.23999999999541000` on ZKE's socket for both `e_btcusdt` and CZR's `usdt1858_btcusdt`, see [`websocket.md`](./websocket.md) section 4, so the index looks shared across the deployment, which is an inference.
Over 60 one-second polls in each of two runs the BTC index took 11 and 4 distinct values, ETH 4 and 8, SOL 9 and 4, NVDA 3 and 3, XAU 1 and 1, and CL 3 and 3, P4.
The runs were on a Saturday in UTC, so a still XAU index is expected, which is an inference.

### Mark

No mark formula is published.
On the wire the mark sat a median of 636 and 538 ppm from the index in two runs, P4.
Beyond 10,000 ppm were only the four unscheduled contracts of section 2.
Over the same polls the BTC mark took 36 and 2 distinct values, ETH 43 and 19, SOL 33 and 5, NVDA 50 and 51, XAU 20 and 26, and CL 27 and 55, P4.
No clamp on the mark premium is published.

### Funding

The interval, caps and clamp are in [`fees.md`](./fees.md) section 6.
`currentFundRate` equalled `nextFundRate` on 206 of 209 contracts in both runs, P4.
On `E-T-USDT` and `E-GWEI-USDT`, the two 1 h contracts, `nextFundRate` was `currentFundRate` cut to six decimals, 0.0000125 against 0.000012.
On `E-ETH-USDT` they parted: `currentFundRate` moved between minus 0.0000018 and plus 0.0000020 over the polls, while `nextFundRate` stayed at 0.00005 in the first run and 0.000052 in the second.
`currentFundRate` was 0.0001 on 179 contracts and 0.00005 on 22, which equal `capitalRate` per 8 h and half of it per 4 h, so most contracts sit at the interest floor, which is an inference.
Which of the two rates is settled at the instant could not be checked, because the open API's `funding_rate` path answered `-1002 UNAUTHORIZED` and no public funding history call was found, P6.
The settlement instant itself was not captured.

## 5. REST book snapshot

`GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=N`, P5.

| item | value |
|---|---|
| depth | `limit` 5, 20 and 100 returned that many per side, `limit` 200 returned 100, no `limit` returned 100. The documented maximum is 100, S13 |
| level order | bids descending and asks ascending on every read |
| numbers | price and size as JSON numbers, `[82648.9,42185]`, where the document shows strings, S13 |
| time | absent, where the document lists a ms `time`, S13 |
| repeat reads | six ETH reads 0.5 s apart showed a new touch on 3 of 5 and 2 of 5 steps |
| other books | 100 levels a side on most of the 209 trading contracts, `E-RSR-USDT` at 16, `E-BSV-USDT` one sided and `E-LUNA-USDT` empty, in both runs |
| spreads | median 3,081 and 3,208 ppm over the 207 two sided books, over 10,000 ppm on 63 and 65, from 28 ppm on BTC to 42,383 ppm |
| major spreads | BTC 28 ppm, ETH 68 ppm, SOL 1,002 and 1,003 ppm, NVDA 1,692 and 1,691 ppm and XAU 1,648 ppm |
| reply | 177 to 183 bytes at 5 levels, 3,066 to 3,072 bytes at 100, 419 to 641 ms |

BTC and ETH are tight, and the long tail is wide enough that a cross on it would cost more than the taker fee.

## 6. Rate limits and errors

ZKE's document says "The total weight of single interface weight according to IP statistics is 12,000 per minute", names 429 for a breach, 418 for a ban of 2 minutes to 3 days, and 410 as a warning, S12.
The public futures endpoints carry no published weight, S13.
No reply carried a rate limit header or `Retry-After`, P6.
Each anchor run made about 570 requests, about ten a second at the peak, and met no limit.

Every error came back as HTTP 200 with a JSON code, P6.

| request | status | body |
|---|---|---|
| `/fapi/v1/index?contractName=E-NOPE-USDT` | 200 | `{"code":"-1121","msg":"BAD_SYMBOL","data":null}` |
| `/fapi/v1/index` with no contract | 200 | the same `-1121` |
| `/fapi/v1/depth?contractName=E-NOPE-USDT` | 200 | the same `-1121` |
| `/fapi/v1/ticker` with no contract | 200 | the same `-1121` |
| `/fapi/v1/nope` | 200 | `{"code":"-1002","data":null,"msg":"UNAUTHORIZED","msgData":null,"succ":false}` |
| `/fapi/v1/funding_rate?contractName=E-BTC-USDT` | 200 | the same `-1002` |
| spot `/sapi/v1/depth?symbol=nope` | 200 | `{"code":"-1121","msg":"Invalid symbol","data":null}` |
| web list with no `exchange-language` | 200 | `{"code":"200004","msg":"parameter illegal","data":null,"msgData":null,"succ":false}` |

## 7. Server time and clock offset

`GET /fapi/v1/time` answered `{"timezone":"GMT+08:00","serverTime":1791605286732}`, P2.
The server clock read 146 to 163 ms ahead of the midpoint of twelve round trips of 396 to 474 ms in two runs.
The trade frames' `ds` field is written in GMT+8, `"ds":"2026-10-10 12:10:52"` beside `"ts":1791605452213`, which is 04:10:52 UTC, P7 in [`websocket.md`](./websocket.md).

## 8. Recommended poller shape

The engine's ChainUp family adapter covers ZKE as one more `Profile`, shaped like Koinbay's at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 142 to 162.
The open choice is the anchor source.
The socket's `mark_price_` frames carry everything, but they stopped partway or right after the subscribe on 6 of the 12 sockets probed, see [`websocket.md`](./websocket.md) section 2.
The REST sweep of `/fapi/v1/index` works for every contract, but with `Schedule::ContractConfig` it has no next settlement, section 3.

| `Profile` field | ZKE value | reason |
|---|---|---|
| `rest` | `https://futuresopenapi.zke.com/fapi/v1` | section 1 |
| `socket` | `wss://futuresws.zke.com/kline-api/ws` | [`websocket.md`](./websocket.md) section 1 |
| `taker_ppm` | 750 | [`fees.md`](./fees.md) section 9 |
| `quotes` | USDT | section 2 |
| `depth` | `Depth::Step0` | [`websocket.md`](./websocket.md) section 4 |
| `anchor` | `AnchorSource::Rest`, or `AnchorSource::MarkPrice` once a stall guard exists | section 3 |
| `schedule` | `Schedule::ContractConfig("https://futuresopenapi.zke.com/v1/inner/contract_config")`, or `Schedule::PublicInfo` once its POST sends `exchange-language` | section 2 |
| `funding` | `FundingField::Current` | the rate that moves with the market, section 4 |
| `keepalive` | `Keepalive::AnswerPing` | [`websocket.md`](./websocket.md) section 5 |
| `max_silence` | 10 s | every contract pushes its book several times a second |
| `markets_per_connection` | 205 | all 205 ran on one socket with their marks |
| `price_scales` | `e_pepeusdt` and `e_shibusdt` at 0.001 | section 2 |
| `denied` | none known, with `e_anthropicusdt` the first to look at in the live identity check | section 4 |

So the named change is in the anchor path, not the catalog.
Either the REST sweep gets its next settlement from a `PublicInfo` schedule that sends the `exchange-language: en_US` header, or the socket anchor gets a guard that reopens a socket whose mark frames stop.
[`../blockfinex/`](../blockfinex/) reported the same mark stall on another ChainUp venue.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S12 | ZKE API Docs, OpenAPI Basic Information | https://help.zke.com/api_en/openapi-basic-information.md | 2026-10-09 | ZKE | spot base URL, HTTP codes, the 12,000 weight limit, sections 1 and 6 |
| S13 | ZKE API Docs, Future Trade | https://help.zke.com/api_en/future-trade.md | 2026-10-09 | ZKE | futures base URL, endpoints, fields, depth limit, the `futuersopenapi` typo, sections 1 to 5 |
| S15 | ZKE web config | https://www.zke.com/fePublicInfo/en_US | 2026-10-09 | ZKE | `coUrl`, `wsUrl`, `openApiDocUrl`, section 1 |
| S16 | Gate public USDT perpetual tickers, used as an outside index reference | https://api.gateio.ws/api/v4/futures/usdt/tickers | 2026-10-09 | Gate | Gate's `index_price` per contract, sections 2 and 4 |
| S17 | ZKE home page | https://www.zke.com/en_US | 2026-10-09 | ZKE | the `chainupcloud.com` scripts and the `/1714/` asset path, section 1 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) mode `host` | | 2026-10-09 | this host, Canadian exit | access, DNS, latency, clock, sections 1 and 7 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) mode `catalog` | | 2026-10-09 | this host | contracts, web list, contract config, tickers, spot symbols, section 2 |
| P4 | [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) mode `anchor` | | 2026-10-09 | this host | index round, Gate compare, one-second polls, sections 2 to 4 |
| P5 | [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) mode `book` | | 2026-10-09 | this host | REST book, sections 2 and 5 |
| P6 | [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) mode `errors` | | 2026-10-09 | this host | error shapes and headers, sections 4 and 6 |
| P7 | [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) mode `basic` | | 2026-10-09 | this host | the trade frame time stamp, section 7 |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) mode `all` | | 2026-10-09 | this host | socket marks against the web list, section 3 |
