# idax REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:23 to 02:42 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures REST API of idax, which has no CCXT class, see [`fees.md`](./fees.md) section 8.
Every claim below was captured by [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) unless a source id says otherwise.
Source ids are shared with [`fees.md`](./fees.md) and [`websocket.md`](./websocket.md).
The short answer is that idax is a ChainUp white label whose catalog, book socket, mark channel and contract config match what the engine's ChainUp family adapter already reads for Koinbay, and whose index tracks Gate's on almost every contract.

## 1. Host and latency from this machine

### Where the API lives

The site's web config names the futures web host `https://futures.idax.exchange` as `coUrl` and links the ChainUp Open API v2 document as `openApiDocUrl`, S11.
The home page loads ChainUp's `microspot.chainupcloud.com` fingerprint script, which marks the white label, S14.
The ChainUp pattern holds: `openapi.<domain>` for spot REST, `futuresopenapi.<domain>` for futures REST and `futuresws.<domain>` for the futures socket, S7 and S8.

### Access, from the Canadian VPN exit

| request | status | reply |
|---|---|---|
| `GET https://www.idax.exchange/`, redirects followed | 200 | the web app, `cf-ray` edge `YVR` |
| `GET https://futuresopenapi.idax.exchange/fapi/v1/ping` | 200 | `{}`, edge `YVR` |
| `GET https://openapi.idax.exchange/sapi/v1/ping` | 200 | `{}`, spot, no Cloudflare |
| `GET https://openapi.idax.exchange/` | 404 | a Spring `Not Found` JSON body |
| `POST https://futures.idax.exchange/fe-co-api/common/public_info` | 200 | the futures web list, given the `exchange-language` header, section 2 |
| `GET https://futuresopenapi.idax.exchange/v1/inner/contract_config` | 200 | the contract config, section 2 |
| `wss://futuresws.idax.exchange/kline-api/ws` | 101 | open in 328 to 1,334 ms, see [`websocket.md`](./websocket.md) section 1 |

Nothing was refused, and no reply carried a region message.
A request with no `User-Agent` header got 200 as well.
Who may trade is in [`fees.md`](./fees.md) section 1.

### Resolution

| host | resolved on 2026-10-10 |
|---|---|
| `futuresopenapi.idax.exchange`, `futuresws.idax.exchange`, `futures.idax.exchange`, `www.idax.exchange` | Cloudflare, `104.21.92.46` and `172.67.186.135` |
| `openapi.idax.exchange` | `35.78.139.104` and `52.195.57.47`, AWS addresses in Tokyo by their range, which is an inference |
| `api.idax.exchange` | no address |

### Latency

| call | first request | warm requests |
|---|---|---|
| `GET /fapi/v1/time` | 155 and 137 ms in two runs | 141 to 363 ms over ten reads, median 198 and 174 ms |
| `GET /fapi/v1/contracts`, 127 KB | 877, 893 and 923 ms | |
| `GET /fapi/v1/index`, one contract | | median 156 to 171 ms over four rounds of 205 calls, max 594 to 949 ms |
| `GET /v1/inner/contract_config`, 136 KB | 541 and 550 ms | |
| `POST /fe-co-api/common/public_info`, 310 KB when it answers | | 134 to 473 ms over fourteen replies, refused ones included |

## 2. Catalog

### The instruments call

`GET https://futuresopenapi.idax.exchange/fapi/v1/contracts` returned 252 rows in 126,849 bytes, P3.

| field | values on 2026-10-10 | meaning, S8 |
|---|---|---|
| `symbol` | `E-BTC-USDT` and 251 more | "Futures name" |
| `type` | `E` on 250, `S` on 1 (`S-BTC-USDT`), `FILCOIN` on 1 (`FILCOIN-BTC-USDT`) | "E: perpetual futures, S: test futures, others are mixed futures" |
| `status` | 1 on 207, 0 on 45 | "0: cannot trade, 1: can trade" |
| `side` | 1 on all 252 | "backwards: 0, 1: forward", read here as linear |
| `marginCoin` | USDT on 250, `EXUSD` on `S-BTC-USDT`, `FILCOIN` on `FILCOIN-BTC-USDT` | |
| `multiplier` | 0.01 on 91, 1 on 44, 0.1 on 17, 5 on 12, 100 on 11, 10 on 9, and 8 rarer values | "Futures face value", in units of `multiplierCoin` |
| fees | `openTakerFee` 0.001 and `openMakerFee` 0.0005 on every live row | see [`fees.md`](./fees.md) section 2 |

205 rows have `type` E and `status` 1, all quoted in USDT.
No base is listed twice, and every `multiplierCoin` appears in its `symbol`.

### The web list and the contract config

Two more calls list the contracts with their funding interval.

| call | rows | what it adds |
|---|---|---|
| `POST https://futures.idax.exchange/fe-co-api/common/public_info` | 205, the 204 perpetuals and `S-BTC-USDT` | `subSymbol` (`e_btcusdt`), `capitalFrequency`, `nextCapitalSettTime`, `capitalIntervalMax`, `assetClass`, and `wsUrl` |
| `GET https://futuresopenapi.idax.exchange/v1/inner/contract_config` | 205, the same set | `capitalFrequency` and `status` 1 on every row, no `subSymbol` and no next settlement |

The web list answers `{"code":"200004","msg":"parameter illegal"}` unless the request carries the header `exchange-language`, P3.
An empty body, a body with only `uaTime`, `exchange-client` alone or `futures-version` alone all got `200004`, and `exchange-language: en_US` alone got the list.
The engine's `Schedule::PublicInfo` posts `{}` with no such header, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 160, so it would fail here.
The contract config needs no header, and its `capitalFrequency` equals the web list's on all 204 shared contracts, P3.
So the Koinbay schedule source, `Schedule::ContractConfig`, fits idax as it is.

The two lists and the open API agree on 204 perpetuals.
`E-BSV-USDT` is live in the open API catalog and absent from both lists, and its mark of 53.48 against an index of 19.09 suggests it is not maintained, section 4.
The adapter keeps only the contracts the schedule holds, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 87 to 89, which drops it.

`GET /fapi/v1/ticker_all` returns 252 rows keyed by the socket name, documented in S8.
All 204 perpetuals of the lists had a ticker time within the last day and a nonzero 24 h volume, P3, so none of them sits idle.

By the web list's `assetClass`, the 204 are 122 crypto contracts, 75 equities, 5 metals (`XPT`, `XAU`, `COPPER`, `PAXG`, `XAG`) and 2 oil (`BZ`, `CL`), P3.
Contract names carry no flag, so an equity name such as `E-ARM-USDT` could collide with a crypto token of the same ticker on another venue.

### Symbol spellings

| where | BTC contract |
|---|---|
| REST `contracts`, `index`, `depth`, `ticker`, the contract config | `E-BTC-USDT`, and `depth` also accepts `e-btc-usdt` |
| web list `subSymbol`, and the socket channel | `e_btcusdt` |
| web list `subSymbolV2` | `e-btc-usdt` |
| web list `symbol` | `BTC-USDT`, which REST refuses with `-1121` |

The engine keys the market on the socket spelling and derives it from the REST name, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 133 to 137, and that rule matched `subSymbol` on all 205 web rows, P3.

### How CCXT maps it

It does not, because CCXT has no idax class.
The engine's ChainUp adapter reads `/contracts` itself, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 25, keeping `type` E, `side` 1 and `status` 1, at lines 61 to 62, with `contract_size` from `multiplier`, at line 100.

### Size unit and price scale

Book sizes on REST and on the socket are whole numbers of contracts, and one contract is `multiplier` coins, see [`websocket.md`](./websocket.md) section 4.
That reading is an inference, since no document states the unit.

`E-SHIB-USDT` and `E-PEPE-USDT` quote a price per 1,000 tokens.
Their index read 0.0054889 and 0.0040174 when Gate's read 0.000005488 and 0.00000401683, and the same ratio of about 1,000 held in all four runs, P4.
Their multipliers are 100 and 500, and a SHIB top ask of 7,266 contracts is about 4,000 USDT if a contract is 100 bundles of 1,000 tokens, against 4 USDT if it were 100 tokens, P4 and P5.
So both need a price scale of 0.001, which is what the Koinbay profile already sets for the same two names, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 161.
No other contract was more than 2.9 % from Gate's index, section 4.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| socket `mark_price_<sub>` | `indexPrice` | `tagPrice` | `currentFundRate` and `nextFundRate` | absent | `nextSettlementTime`, Unix ms | about 220 bytes, one contract, 26 and 56 frames a minute in two runs | pushed |
| `GET /fapi/v1/index?contractName=E-BTC-USDT` | `indexPrice` | `tagPrice` | `currentFundRate` and `nextFundRate` | absent | absent | one contract | median 156 to 171 ms |
| `GET /v1/inner/contract_config` | absent | absent | absent | `capitalFrequency`, hours | absent | 136 KB, 205 rows | 541 and 550 ms |
| `POST /fe-co-api/common/public_info` | absent | absent | absent | `capitalFrequency`, hours | `nextCapitalSettTime`, Unix ms | 310 KB, 205 rows | 134 to 473 ms |

No REST call returns index, mark and funding for every contract at once.
`/fapi/v1/index` requires `contractName`, and one round over 205 contracts, four at a time, took 10,131, 9,636, 9,736 and 10,360 ms in four runs, P4.
The socket carries all three for every contract on the book socket, P8 in [`websocket.md`](./websocket.md).
`nextSettlementTime` on the socket equalled the web list's `nextCapitalSettTime` on 204 of 204 in both runs, P8.

The ChainUp document shows an `index` reply of `indexPrice`, `markPrice`, `contractName` and `lastFundingRate`, S8.
The wire carried `currentFundRate`, `tagPrice`, `indexPrice` and `nextFundRate` on all 205, P4.

The BTC reply at 02:40 UTC, as the probe printed it after parsing:

```json
{"currentFundRate": 2.7e-05, "tagPrice": 82632.47000000333, "indexPrice": 82672.60333333333, "nextFundRate": 2.7e-05}
```

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` of the frame, `e_btcusdt` | string | none |
| `index` | `indexPrice` | decimal string on the socket, JSON number on REST | parse, and scale `E-SHIB-USDT` and `E-PEPE-USDT` with the market |
| `mark` | `tagPrice` | decimal string | as above |
| `fundingRate` | `currentFundRate` | fraction per period, decimal string | parse |
| `fundingIntervalHours` | `capitalFrequency` of the contract config | hours, 8, 4 or 1 | none |
| `nextFundingAt` | `nextSettlementTime` | Unix ms as a string | parse |

This is the `AnchorSource::MarkPrice` mapping the adapter uses for Koinbay, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 363 to 369.

## 4. Anchor semantics

### Index

The help center says the index is a weighted average of "the latest transaction price of the standard currency pair of the mainstream exchange", sampled every second, S4.
A source not updated within 40,000 ms is set aside, and a source more than 3 % from the median is clamped to the median plus or minus 3 %, S4.
The page shows weights of 33.3 % on three sources for BTCUSDT and ETHUSDT, and the source names are images that the text does not carry, S4.
No basket call is public.

Against one read of Gate's public USDT perpetual index, S12, the idax index was within 1,000 ppm on 164, 173, 174 and 173 of the 201 contracts both venues list, in four runs from 02:24 to 02:40 UTC, with a median gap of 430, 344, 296 and 296 ppm, P4.
The wide ones besides SHIB and PEPE were `E-ANTHROPIC-USDT` at 19,909 to 20,800 ppm in every run, `E-MAGIC-USDT` at 5,880 to 28,702 ppm, and `E-GMT-USDT` at 7,307 to 8,395 ppm.
`E-ANTHROPIC-USDT` is a pre-IPO contract, and its two venues may price it from different sources, which is an inference.
The equity and metal contracts were read on a Saturday in UTC, when their underlying markets were shut.
Over 60 one-second polls the BTC index took 7, 3 and 15 distinct values in three runs and the SOL index 7, 8 and 7, so it moves every few seconds, P4.
The XAU index took 1, 1 and 2 values, and TSLA 3 in each run, with their markets shut.

### Mark

The help center gives the mark as the median of the latest price, a reasonable price and a moving average price, S3.
The reasonable price is index times 1 plus the previous period's rate times the time to the next settlement over the interval, S3.
On the wire the mark sat a median of 409 to 620 ppm from the index in four runs, P4.
One contract was far off, `E-BSV-USDT`, with a mark of 53.48 against an index of 19.08 or 19.09 in every run, and it is the one the schedule drops, section 2.
Over 60 one-second polls the BTC mark took 24, 22 and 58 distinct values.
No clamp on the mark premium is published.

### Funding

The formula, interval and cap are in [`fees.md`](./fees.md) section 6.
`currentFundRate` equalled `nextFundRate` on 202 of 205 contracts in all four rounds, P4.
The documentation says the current period's rate "will not change during the period", S2.
The BTC `currentFundRate` read 0.000028 at 02:24 UTC, 0.000029 at 02:26, 0.000027 at 02:31, 02:33, 02:39 and 02:40, and 0.000026 at 02:41, so it moved within one period, P4 and P7 in [`websocket.md`](./websocket.md).
ETH took 3 distinct `currentFundRate` values in 60 one-second polls in each of three runs, and XAU 3, 3 and 2, P4.
So the published rate behaves like the forecast that the documentation describes as recalculated every minute, which is an inference.
Which value is settled at the instant could not be checked, because no public funding history call was found, S8.
The settlement instant itself was not captured.

## 5. REST book snapshot

`GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=N`, P5.

| item | value |
|---|---|
| depth | `limit` 5, 20 and 100 returned that many per side, `limit` 200 and 1000 returned 100, no `limit` returned 100. The documented maximum is 100, S8 |
| level order | bids descending and asks ascending on every read |
| numbers | price and size as JSON numbers, `[82601,21073]` |
| time | `time` is `null`, against a documented ms timestamp, S8 |
| repeat reads | six ETH reads 0.5 s apart showed the same touch on all six in two runs, and a new touch on each of the five steps in the third |
| other books | 77 to 100 levels a side on the eleven small crypto contracts sampled over two runs, 90 a side on `E-XAG-USDT`, `E-XPT-USDT` and `E-BZ-USDT`, 100 on `E-KLAC-USDT` |
| spreads | 10,893 to 17,438 ppm on ten of those crypto contracts and 2,848 ppm on `E-OP-USDT`, 605 ppm on `E-PAXG-USDT`, and 1,654 to 2,400 ppm on the metal, oil and equity samples, read on a Saturday in UTC |
| reply | 177 to 185 bytes at 5 levels, 3,058 to 3,086 bytes at 100, 138 to 236 ms |

## 6. Rate limits and errors

The ChainUp document says "The total weight of single interface weight according to IP statistics is 12,000 per minute" and 60,000 per minute per account, S7.
It names 429 for a breach, 418 for an IP ban "from a minimum of 2 minutes to a maximum of 3 days", and also says "HTTP 410 return code is used when breaking a request rate limit", S7.
The futures endpoints carry no published weight.
No reply carried a rate limit header or `Retry-After`, P6.
The anchor runs made about 510 requests each, about 25 a second at the peak, and met no limit.
One reply during the second pass was not JSON and stopped that run of the probe before its body was kept, so the probe now records such replies, and the rerun saw none.

Every error came back as HTTP 200 with a JSON code, P6.

| request | status | body |
|---|---|---|
| `/fapi/v1/index?contractName=E-NOPE-USDT` | 200 | `{"code":"-1121","msg":"BAD_SYMBOL","data":null}` |
| `/fapi/v1/index` with no contract | 200 | the same `-1121` |
| `/fapi/v1/depth?contractName=E-NOPE-USDT` | 200 | the same `-1121` |
| `/fapi/v1/ticker` with no contract | 200 | the same `-1121` |
| `/fapi/v1/nope` | 200 | `{"code":"-1002","data":null,"msg":"UNAUTHORIZED","msgData":null,"succ":false}` |
| spot `/sapi/v1/depth?symbol=nope` | 200 | `{"code":"-1121","msg":"Invalid symbol","data":null}` |
| web list with no `exchange-language` | 200 | `{"code":"200004","msg":"parameter illegal","data":null,"msgData":null,"succ":false}` |

## 7. Server time and clock offset

`GET /fapi/v1/time` answered `{"timezone":"GMT+08:00","serverTime":1791599033178}`, P2.
The server clock read 17 to 126 ms ahead of the midpoint of twelve round trips of 137 to 363 ms in two runs.
The time stamps in the socket's trade frames are written in GMT+8 too, `"ds":"2026-10-10 10:26:46"` beside `"ts":1791599206133`, which is 02:26:46 UTC, P7 in [`websocket.md`](./websocket.md).

## 8. Recommended poller shape

No separate REST poller is needed.
The engine's ChainUp family adapter reads the anchor from the `mark_price_` frames on the book socket and the interval from a contract config read once a minute, and idax serves both.
An idax profile would be the Koinbay profile, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 142 to 162, with these values.

| `Profile` field | idax value | reason |
|---|---|---|
| `rest` | `https://futuresopenapi.idax.exchange/fapi/v1` | section 1 |
| `socket` | `wss://futuresws.idax.exchange/kline-api/ws` | [`websocket.md`](./websocket.md) section 1 |
| `taker_ppm` | 1000 | [`fees.md`](./fees.md) section 9 |
| `quotes` | USDT | section 2 |
| `depth` | `Depth::Step0` | [`websocket.md`](./websocket.md) section 4 |
| `anchor` | `AnchorSource::MarkPrice` | section 3 |
| `schedule` | `Schedule::ContractConfig("https://futuresopenapi.idax.exchange/v1/inner/contract_config")` | the web list needs a header the adapter does not send, section 2 |
| `funding` | `FundingField::Current` | the two rates were equal on 202 of 205, section 4 |
| `keepalive` | `Keepalive::AnswerPing` | [`websocket.md`](./websocket.md) section 5 |
| `max_silence` | 10 s | every contract pushes about twice a second |
| `markets_per_connection` | 100 | 204 ran on one socket |
| `price_scales` | `e_shibusdt` and `e_pepeusdt` at 0.001 | section 2 |
| `denied` | to be found by the engine's live identity check, with `e_anthropicusdt` the first to look at | section 4 |

The adapter's REST fallback, `AnchorSource::Rest`, would also work, since `/fapi/v1/index` is public, but a round of 205 calls takes about 10 s at four in flight.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S2 | Funding rate | https://support.idax.exchange/docs/funding-rate/ | 2026-10-09 | idax help center | the fixed rate rule, section 4 |
| S3 | Mark price | https://support.idax.exchange/docs/mark-price/ | 2026-10-09 | idax help center | mark formula, section 4 |
| S4 | Index price | https://support.idax.exchange/docs/index-price/ | 2026-10-09 | idax help center | index rules, section 4 |
| S7 | ChainUp Open API v2, overview | https://exchangedocsv2.gitbook.io/open-api-doc-v2/ | 2026-10-09 | ChainUp, linked from S11 | limits and HTTP codes, section 6 |
| S8 | ChainUp Open API v2, futures | https://exchangedocsv2.gitbook.io/open-api-doc-v2/futures | 2026-10-09 | ChainUp | endpoints, fields, depth limit, sections 2 to 5 |
| S11 | idax web config | https://www.idax.exchange/fePublicInfo/en_US | 2026-10-09 | idax | `coUrl`, `openApiDocUrl`, section 1 |
| S12 | Gate public USDT perpetual tickers, used as an outside index reference | https://api.gateio.ws/api/v4/futures/usdt/tickers | 2026-10-09 | Gate | Gate's `index_price` per contract, sections 2 and 4 |
| S14 | idax home page | https://www.idax.exchange/en_US | 2026-10-09 | idax | the ChainUp script, section 1 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) mode `host` | | 2026-10-09 | this host, Canadian exit | access, DNS, latency, clock, sections 1 and 7 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) mode `catalog` | | 2026-10-09 | this host | contracts, web list, contract config, spot symbols, section 2 |
| P4 | [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) mode `anchor` | | 2026-10-09 | this host | index round, Gate compare, one-second polls, sections 3 and 4 |
| P5 | [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) mode `book` | | 2026-10-09 | this host | REST book, section 5 |
| P6 | [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) mode `errors` | | 2026-10-09 | this host | error shapes and headers, section 6 |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/idax/ws-probe.py) mode `all` | | 2026-10-09 | this host | socket marks against the web list, section 3 |
