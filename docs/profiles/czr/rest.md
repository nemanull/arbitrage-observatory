# CZR Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:51 to 03:09 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures REST API of CZR Exchange, which has no CCXT class, see [`fees.md`](./fees.md) section 8.
Every claim below was captured by [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) unless a source id says otherwise.
Source ids are shared with [`fees.md`](./fees.md) and [`websocket.md`](./websocket.md).
The short answer is that CZR is a ChainUp white label whose book socket, mark channel and contract config match what the engine's ChainUp family adapter reads for Koinbay.
The one thing that does not match is the contract naming: CZR's open API writes `type` `USDT1858` and `marginCoin` `USDT1858` where the adapter expects `E` and `USDT`, so its catalog filter keeps no CZR contract today.

## 1. Host and latency from this machine

### Where the API lives

The site's web config names the futures web host `https://futures.czrex.com` as `coUrl`, the spot socket `wss://ws.czr.global/kline-api/ws` as `wsUrl`, and links the ChainUp Open API v2 document as `openApiDocUrl`, S8.
The home page loads ChainUp's `microspot.chainupcloud.com` script, which marks the white label, S10.
The ChainUp pattern holds: `openapi.czrex.com` for spot REST, `futuresopenapi.czrex.com` for futures REST, and a futures socket the web list names, S11 and S9.

### Access, from the Canadian VPN exit

| request | status | reply |
|---|---|---|
| `GET https://www.czrex.com/` | 200 | the web app, `server: cloudflare`, `cf-ray` edge `YVR` |
| `GET https://www.czrex.com/cdn-cgi/trace` | 200 | `loc=CA`, `colo=YVR` |
| `GET https://futuresopenapi.czrex.com/fapi/v1/ping` | 200 | `{}`, `server: webserver`, no Cloudflare |
| `GET https://openapi.czrex.com/sapi/v1/ping` | 200 | `{}` |
| `GET https://openapi.czrex.com/` | 404 | a Spring `Not Found` JSON body |
| `GET https://futures.czrex.com/` | 200 | the futures web app |
| `POST https://futures.czrex.com/fe-co-api/common/public_info` | 200 | the futures web list, given the `exchange-language` header, section 2 |
| `GET https://futuresopenapi.czrex.com/v1/inner/contract_config` | 200 | the contract config, section 2 |
| `wss://futuresws.czr.global/kline-api/ws` | 101 | see [`websocket.md`](./websocket.md) section 1 |
| `GET https://www.czrex.us/`, the United States site the terms name | 200 | a separate site behind Cloudflare, not researched |

Nothing was refused, and no reply carried a region message, although Canada is a restricted jurisdiction, see [`fees.md`](./fees.md) section 1.
A request with no `User-Agent` header got 200 as well.

### Resolution

| host | resolved on 2026-10-10 |
|---|---|
| `futuresopenapi.czrex.com`, `openapi.czrex.com`, `futures.czrex.com`, `futuresws.czrex.com`, `ws.czrex.com`, `futuresws.czr.global`, `ws.czr.global` | `35.78.139.104` and `52.195.57.47`, through the CNAME `cloong-alb-internet-h5-v6-1615804683.ap-northeast-1.elb.amazonaws.com`, an AWS load balancer in Tokyo |
| `www.czrex.com` | Cloudflare, `104.21.61.87` and `172.67.207.249` |
| `api.czrex.com` | no address |

The CNAME was read with `dig` on 2026-10-10 UTC.
[`../idax/rest.md`](../idax/rest.md) section 1 found idax's `openapi` host on the same two addresses, so the load balancer serves more than one ChainUp tenant, which is an inference.

### Latency

| call | first request | warm requests |
|---|---|---|
| `GET /fapi/v1/time` | 401 and 416 ms in two runs | 398 to 664 ms over ten reads, median 417 and 430 ms |
| `GET /fapi/v1/contracts`, 27 KB | 712 and 687 ms | |
| `GET /v1/inner/contract_config`, 35 KB | 675 and 719 ms | |
| `POST /fe-co-api/common/public_info`, 84 KB | 674 and 711 ms | |
| `GET /fapi/v1/index`, one contract | | median 460 and 438 ms over two rounds of 50 calls |

Every call crosses the Pacific to Tokyo, which sets the floor near 400 ms.

## 2. Catalog

### The instruments call

`GET https://futuresopenapi.czrex.com/fapi/v1/contracts` returned 52 rows in 27,158 bytes in both runs, P3.

| field | values on 2026-10-10 | meaning, S11 |
|---|---|---|
| `symbol` | `USDT1858-BTC-USDT` and 50 more, and `S-BTC-USDT` | "Futures name" |
| `type` | `USDT1858` on 51, `S` on 1 | "E: perpetual futures, S: test futures, others are mixed futures" |
| `status` | 1 on 51, 0 on 1 (`USDT1858-LAB-USDT`) | "0: cannot trade, 1: can trade" |
| `side` | 1 on all 52 | read here as linear |
| `marginCoin` | `USDT1858` on 51, `EXUSD` on `S-BTC-USDT` | |
| `multiplier` | 1 on 23, 0.1 on 18, 0.01 on 5, 0.001 on 4, among the 50 live | "Futures face value", in units of `multiplierCoin` |
| fees | `openTakerFee` 0.0005 and `openMakerFee` 0.0002 on every live row | see [`fees.md`](./fees.md) section 2 |

50 rows have `type` `USDT1858`, `side` 1 and `status` 1, all quoted in USDT.
No base is listed twice, and every `multiplierCoin` appears in its `symbol`.
The 50 bases are crypto tokens with two gold tokens, `PAXG` and `XAUT`, and one more, `CL`, P3.
`USDT1858-CL-USDT` had an index of 90.69 when Gate's `CL_USDT` read 90.67, P4, so it tracks what Gate lists as `CL_USDT`, which reads as crude oil, an inference.
The web list gives every row `assetClass` 1, so no field flags it.

`USDT1858` is not a perpetual type the ChainUp document names.
The spot catalog writes the same tenant number into every asset, `eth1858usdt1858` with `baseAsset` `ETH1858`, and the site's asset CDN path is `/1858/`, S10 and P3.
So `1858` reads as CZR's tenant id on a shared ChainUp deployment, and that is an inference.
The web list, by contrast, gives the same contracts `contractType` E and `marginCoin` USDT, and keeps the tenant only in `originalCoin` `USDT1858`, P3.

### The web list and the contract config

Two more calls list the contracts with their funding interval.

| call | rows | what it adds |
|---|---|---|
| `POST https://futures.czrex.com/fe-co-api/common/public_info` | 51, the 50 perpetuals and `S-BTC-USDT` | `subSymbol` (`usdt1858_btcusdt`), `capitalFrequency`, `nextCapitalSettTime`, `capitalIntervalMax`, `feeRateVo`, and `wsUrl` |
| `GET https://futuresopenapi.czrex.com/v1/inner/contract_config` | 51, the same set | `capitalFrequency` and `status` 1 on every row, `contractType` `USDT1858`, no `subSymbol` and no next settlement |

The web list answers `{"code":"200004","msg":"parameter illegal"}` to an empty body with no `exchange-language` header, and the full list with `exchange-language: en_US`, P3.
The engine's `Schedule::PublicInfo` posts `{}` with no such header, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 160, so it would fail here as it does on idax.
The contract config needs no header, and its `capitalFrequency` equals the web list's on all 51 shared rows, P3.
So the Koinbay schedule source, `Schedule::ContractConfig`, fits CZR.
The adapter derives the raw id from `contractName` when a row has no `subSymbol`, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 178, which gives `usdt1858_btcusdt`.

The three lists agree on the same 50 perpetuals, P3.
`GET /fapi/v1/ticker_all` returns 52 rows keyed by the socket name, and all 50 perpetuals had a ticker time within the last day and a nonzero 24 h volume, P3.

### Symbol spellings

| where | BTC contract |
|---|---|
| REST `contracts`, `index`, `depth`, `ticker`, the contract config | `USDT1858-BTC-USDT`, and `depth` also accepts `usdt1858-btc-usdt` |
| web list `subSymbol`, `ticker_all` keys, and the socket channel | `usdt1858_btcusdt` |
| web list `subSymbolV2` | `usdt1858-btc-usdt` |
| web list `symbol` | `BTC-USDT`, which REST refuses with `-1121` |
| `E-BTC-USDT`, the spelling of other ChainUp venues | REST refuses it with `-1121` |

The engine keys the market on the socket spelling and derives it from the REST name, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 131 to 139, and that rule matched `subSymbol` on all 51 web rows, P3.

### How CCXT maps it

It does not, because CCXT has no CZR class.
The engine's ChainUp adapter reads `/contracts` itself, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 26.
It keeps a row only when `type` is E, `side` is 1 and `status` is 1, at line 62, and only when `marginCoin` equals the quote, at line 70.
Every live CZR row has `type` `USDT1858` and `marginCoin` `USDT1858`, so both checks drop all 50, and the venue would load with no market.
This is the named change: a CZR profile needs the adapter to accept the profile's own contract type, `USDT1858`, in place of E, and to read `marginCoin` `USDT1858` as USDT.
The rest of the row maps as on Koinbay, with `contract_size` from `multiplier`, at line 100.

### Size unit and price scale

Book sizes on REST and on the socket are whole numbers of contracts, and one contract is `multiplier` coins, see [`websocket.md`](./websocket.md) section 4.
No contract quotes a price per bundle of tokens, since the 50 indices sit a median of 153 ppm from Gate's and none beyond 3,037 ppm, section 4.
So no price scale is needed.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| socket `mark_price_<sub>` | `indexPrice` | `tagPrice` | `currentFundRate` and `nextFundRate` | absent | `nextSettlementTime`, Unix ms | one contract, 23 and 54 frames a minute in two runs | pushed |
| `GET /fapi/v1/index?contractName=USDT1858-BTC-USDT` | `indexPrice` | `tagPrice` | `currentFundRate` and `nextFundRate` | absent | absent | one contract | median 460 and 438 ms |
| `GET /v1/inner/contract_config` | absent | absent | absent | `capitalFrequency`, hours | absent | 35 KB, 51 rows | 675 and 719 ms |
| `POST /fe-co-api/common/public_info` | absent | absent | absent | `capitalFrequency`, hours | `nextCapitalSettTime`, Unix ms | 84 KB, 51 rows | 674 and 711 ms |

No REST call returns index, mark and funding for every contract at once.
`/fapi/v1/index` requires `contractName`, and one round over 50 contracts, four at a time, took 7,138 and 5,857 ms in two runs, P4.
The socket carries all three for every contract on the book socket, P8 in [`websocket.md`](./websocket.md).
`nextSettlementTime` on the socket equalled the web list's `nextCapitalSettTime` on 50 of 50 in the first run, P8.
In the second, at 03:05 UTC, it differed on the two 1 h contracts, DEXE and PIPPIN, where the web list still named 03:00 UTC, which had passed, and the socket named 04:00 UTC.
So the socket is the fresher source for the next settlement.

The ChainUp document shows an `index` reply of `indexPrice`, `markPrice`, `contractName` and `lastFundingRate`, S11.
The wire carried `currentFundRate`, `tagPrice`, `indexPrice` and `nextFundRate` on all 50, P4.

The BTC reply at 02:57 UTC, as the probe printed it after parsing:

```json
{"currentFundRate": 1e-05, "tagPrice": 82589.47190476333, "indexPrice": 82627.90333333334, "nextFundRate": 1e-05}
```

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` of the frame, `usdt1858_btcusdt` | string | none |
| `index` | `indexPrice` | decimal string on the socket, JSON number on REST | parse |
| `mark` | `tagPrice` | decimal string | parse |
| `fundingRate` | `currentFundRate` | fraction per period, decimal string | parse |
| `fundingIntervalHours` | `capitalFrequency` of the contract config | hours, 8, 4, 2 or 1 | none |
| `nextFundingAt` | `nextSettlementTime` | Unix ms as a string | parse |

This is the `AnchorSource::MarkPrice` mapping the adapter uses for Koinbay, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 363 to 369.

## 4. Anchor semantics

### Index

CZR publishes no index page that this research found, so the formula and basket are Not publicly specified, S6.
No basket call is public.
Against one read of Gate's public USDT perpetual index, S12, the CZR index was within 1,000 ppm on 46 of the 50 contracts in both runs, with a median gap of 153 and 161 ppm, P4.
`USDT1858-SPX-USDT` was the widest in both runs, at 3,037 and 2,850 ppm, and no other contract passed 1,900 ppm.
The BTC index read `82632.63333333332874610` on CZR's socket for both `usdt1858_btcusdt` and the other tenant's `e_btcusdt`, see [`websocket.md`](./websocket.md) section 4, so the index looks shared across the deployment, which is an inference.
Over 60 one-second polls in each of two runs the BTC index took 4 and 7 distinct values, ETH 3 and 4, SOL 10 and 10, PAXG 2 and 3, and CL 3 and 3, P4.

### Mark

No mark formula is published, S6.
On the wire the mark sat a median of 700 and 662 ppm from the index in two runs, and at most 4,484 and 5,013 ppm, P4.
Over the same polls the BTC mark took 46 and 48 distinct values, ETH 44 and 41, SOL 28 and 17, PAXG 20 and 27, and CL 58 and 6, P4.
No clamp on the mark premium is published.

### Funding

The formula, interval and cap are in [`fees.md`](./fees.md) section 6.
`currentFundRate` equalled `nextFundRate` on 47 and 48 of 50 contracts in two runs, and on the others `nextFundRate` was `currentFundRate` cut to six decimals, such as 0.0000125 against 0.000012 on DEXE, P4.
Over the one-second polls the BTC, ETH, SOL and PAXG rates did not move, and CL took 3 values in each run, from minus 0.000029 to minus 0.000023 in the first and from 0.000007 to 0.000013 in the second, so the published rate can move within a minute, P4.
That fits a forecast recalculated during the period, which is an inference.
Which value is settled at the instant could not be checked, because the open API's `funding_rate` path answered `-1002 UNAUTHORIZED` and no public funding history call was found, P6.
The settlement instant itself was not captured.

## 5. REST book snapshot

`GET /fapi/v1/depth?contractName=USDT1858-BTC-USDT&limit=N`, P5.

| item | value |
|---|---|
| depth | `limit` 5, 20 and 100 returned that many per side, `limit` 200 returned 100, no `limit` returned 100. The documented maximum is 100, S11 |
| level order | bids descending and asks ascending on every read |
| numbers | price and size as JSON numbers, `[82508.2,21292]` |
| time | `time` is `null`, against a documented ms timestamp, S11 |
| repeat reads | six ETH reads 0.5 s apart showed a new touch on 4 of 5 steps in one run and on 5 of 5 in the other |
| other books | at least 12 and 11 levels a side on every one of the 50 contracts in two runs, and 100 a side on BTC, ETH and SOL |
| spreads | median 552 and 637 ppm over the 50 contracts in two runs, from 203 to 7,692 and 3,846 ppm, with BTC at 2,005 ppm both times, ETH at 2,013 and 1,953 ppm and SOL at 456 ppm |
| reply | 166 to 175 bytes at 5 levels, 3,012 to 3,028 bytes at 100, 400 to 538 ms |

The BTC and ETH spreads near 2,000 ppm are wide for those pairs, and a cross against them would cost more than the taker fee.

## 6. Rate limits and errors

The ChainUp document says "The total weight of single interface weight according to IP statistics is 12,000 per minute", and names 429 for a breach and 418 for an IP ban, S11.
The futures endpoints carry no published weight.
No reply carried a rate limit header or `Retry-After`, P6.
Each anchor run made about 350 requests, about eight a second at the peak, and met no limit.

Every error came back as HTTP 200 with a JSON code, P6.

| request | status | body |
|---|---|---|
| `/fapi/v1/index?contractName=USDT1858-NOPE-USDT` | 200 | `{"code":"-1121","msg":"BAD_SYMBOL","data":null}` |
| `/fapi/v1/index` with no contract | 200 | the same `-1121` |
| `/fapi/v1/depth?contractName=USDT1858-NOPE-USDT` | 200 | the same `-1121` |
| `/fapi/v1/ticker` with no contract | 200 | the same `-1121` |
| `/fapi/v1/nope` | 200 | `{"code":"-1002","data":null,"msg":"UNAUTHORIZED","msgData":null,"succ":false}` |
| `/fapi/v1/funding_rate?contractName=USDT1858-BTC-USDT` | 200 | the same `-1002` |
| spot `/sapi/v1/depth?symbol=nope` | 200 | `{"code":"-1121","msg":"Invalid symbol","data":null}` |
| web list with no `exchange-language` | 200 | `{"code":"200004","msg":"parameter illegal","data":null,"msgData":null,"succ":false}` |

## 7. Server time and clock offset

`GET /fapi/v1/time` answered `{"timezone":"GMT+08:00","serverTime":1791600964463}`, P2.
The server clock read 130 to 252 ms ahead of the midpoint of twelve round trips of 398 to 664 ms in two runs.
The time stamps in the socket's trade frames are written in GMT+8 too, `"ds":"2026-10-10 10:57:51"` beside `"ts":1791601071883`, which is 02:57:51 UTC, P7 in [`websocket.md`](./websocket.md).

## 8. Recommended poller shape

No separate REST poller is needed.
The engine's ChainUp family adapter reads the anchor from the `mark_price_` frames on the book socket and the interval from a contract config read about once a minute, and CZR serves both.
A CZR profile would be the Koinbay profile, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 142 to 162, with these values, once the catalog filter accepts the tenant type of section 2.

| `Profile` field | CZR value | reason |
|---|---|---|
| `rest` | `https://futuresopenapi.czrex.com/fapi/v1` | section 1 |
| `socket` | `wss://futuresws.czr.global/kline-api/ws` | [`websocket.md`](./websocket.md) section 1 |
| `taker_ppm` | 500 | [`fees.md`](./fees.md) section 9 |
| `quotes` | USDT | section 2 |
| `depth` | `Depth::Step0` | [`websocket.md`](./websocket.md) section 4 |
| `anchor` | `AnchorSource::MarkPrice` | section 3 |
| `schedule` | `Schedule::ContractConfig("https://futuresopenapi.czrex.com/v1/inner/contract_config")` | the web list needs a header the adapter does not send, section 2 |
| `funding` | `FundingField::Current` | `nextFundRate` is the same rate cut to six decimals, section 4 |
| `keepalive` | `Keepalive::AnswerPing` | [`websocket.md`](./websocket.md) section 5 |
| `max_silence` | 10 s | every contract pushes about twice a second |
| `markets_per_connection` | 100 | 50 ran on one socket |
| `price_scales` | none | section 2 |
| `denied` | to be found by the engine's live identity check, with `usdt1858_clusdt`, which tracks Gate's `CL_USDT`, the first to look at | section 2 |
| new | the contract type `USDT1858` and the margin coin `USDT1858` read as USDT | section 2 |

The adapter's REST fallback, `AnchorSource::Rest`, would also work, since `/fapi/v1/index` is public, but a round of 50 calls takes about 7 s at four in flight from this host.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S6 | Footer cms list | https://www.czrex.com/fe-ex-api/cms/footer/list/newPc | 2026-10-09 | CZR | no index, mark or funding page among the cms pages, section 4 |
| S8 | CZR web config | https://www.czrex.com/fePublicInfo/en_US | 2026-10-09 | CZR | `coUrl`, `wsUrl`, `openApiDocUrl`, section 1 |
| S9 | ChainUp Open API v2, WebSocket | https://exchangedocsv2.gitbook.io/open-api-doc-v2/websocket | 2026-10-09 | ChainUp | the socket host pattern, section 1 |
| S10 | CZR home page | https://www.czrex.com/en_US | 2026-10-09 | CZR | the ChainUp script and the `/1858/` asset path, sections 1 and 2 |
| S11 | ChainUp Open API v2, overview and futures | https://exchangedocsv2.gitbook.io/open-api-doc-v2/ | 2026-10-09 | ChainUp, linked as `openApiDocUrl` in S8 | endpoints, fields, types, depth limit, rate limits, sections 2 to 6 |
| S12 | Gate public USDT perpetual tickers, used as an outside index reference | https://api.gateio.ws/api/v4/futures/usdt/tickers | 2026-10-09 | Gate | Gate's `index_price` per contract, section 4 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) mode `host` | | 2026-10-09 | this host, Canadian exit | access, DNS, latency, clock, sections 1 and 7 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) mode `catalog` | | 2026-10-09 | this host | contracts, web list, contract config, tickers, spot symbols, section 2 |
| P4 | [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) mode `anchor` | | 2026-10-09 | this host | index round, Gate compare, one-second polls, sections 3 and 4 |
| P5 | [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) mode `book` | | 2026-10-09 | this host | REST book, section 5 |
| P6 | [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) mode `errors` | | 2026-10-09 | this host | error shapes and headers, sections 4 and 6 |
| P7 | [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py) mode `basic` | | 2026-10-09 | this host | the trade frame time stamp, section 7 |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py) mode `all` | | 2026-10-09 | this host | socket marks against the web list, section 3 |
