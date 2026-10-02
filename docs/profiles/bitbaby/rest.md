# Bitbaby REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:12 to 04:50 UTC, from the development host near Seattle through its Canadian VPN exit.

This profile covers the public REST surface of Bitbaby, which has no CCXT class, for both perpetual families.
Bitbaby's footer links an API Documentation page that points to `https://docs.bitbaby.com/en/`, and that host answered 404 on every path, so no documented API exists to profile.
Every call below is one the website itself makes to `web-api.bitbaby.com`, found in its JavaScript bundle, S4, and read by [`rest-probe.mjs`](../../../scripts/probes/venues/bitbaby/rest-probe.mjs).
These calls are undocumented, take a JSON `POST` body, and can change without notice.
Access results are from a Canadian VPN exit, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

### Documented API hosts

| URL | reply | source |
|---|---|---|
| `https://docs.bitbaby.com/en/`, the footer's API Documentation target | 404, 146 byte nginx page, in four runs | P1 |
| `https://docs.bitbaby.com/` | 404, same page | P1 |
| `https://docs.bitbaby.com/en/` through WebFetch, which does not originate here | "The server returned HTTP 404 Not Found." | S2 |
| Wayback Machine CDX for `docs.bitbaby.com*` | no capture | S3 |
| `https://www.bitbaby.com/en-us/exchange-open-api`, the `open_api_url` of the spot site configuration | 404, the website's own not-found page | P1 |
| `https://openapi.bitbaby.com/sapi/v1/ping`, `/fapi/v1/contracts`, `/fapi/v1/ticker?contractName=E-BTC-USDT`, the ChainUp open API paths | 404, 146 byte nginx page | P1 |
| `futures.bitbaby.com`, the configured `coUrl` | does not resolve, `ENOTFOUND` | P1 |

The 404 came back the same through a fetch from elsewhere, so it is not a regional refusal of this host.

### Hosts that answered

| host | resolved on 2026-09-23 | used for |
|---|---|---|
| `web-api.bitbaby.com` | 104.17.136.113 and 104.17.137.113, a Cloudflare pair behind the alias `web-api.bitbaby.com.cloudscdn.net` | every call below, and the market socket |
| `api.bitbaby.com` | the same pair | the same backend: `public_info_v2` answered there with the same 358,240 bytes |
| `www.bitbaby.com` | the same pair | the website |
| `api.influencelab.xyz` | 8.216.32.171 | the configured `wsUrl`, whose certificate is for `symini.com`, see [`websocket.md`](./websocket.md) section 1 |

Cloudflare's trace answered `loc=CA` through its SEA and YVR edges for this host's exit, 216.246.31.78.

### Request time

| call | reply | first request | warm requests | source |
|---|---|---|---|---|
| `POST /futures/api/common/public_info_v2` | 358,240 or 358,241 bytes | 1,761 to 2,586 ms in four runs | 1,556 to 2,652 ms, twelve requests | P1 |
| `POST /futures/api/common/public_market_info` | 197 bytes for BTC | | 119 to 546 ms, median 125 to 128 ms, 180 requests over two runs | P2 |
| `POST /spot/api/common/is_us_ip` | 241 bytes | 463 to 535 ms in four runs | | P1 |

The catalog reply is `cf-cache-status: DYNAMIC`, so every request reaches the origin, and it is slow for its size.

## 2. Catalog

### The instruments call

`POST https://web-api.bitbaby.com/futures/api/common/public_info_v2` with body `{}` returns `data.contractList`, P1.
The website embeds the same list in its home page as `futuresConfig`.
A `GET` on it answers HTTP 200 with `{"code":"200008","msg":"Method not allowed"}`.

| field | meaning, as observed | values on 2026-09-23 |
|---|---|---|
| `id` | numeric contract id, the key of `public_market_info` | 1 for `E-BTC-USDT` |
| `contractName` | `E-<base>-<quote>` | 358 of 358 follow the pattern |
| `symbol`, `contractOtherName` | `BTC-USDT`, `BTCUSDT` | |
| `subSymbol` | `e_<base><quote>` lowercase, the socket's channel key | 358 of 358 |
| `marginCoin` | settlement asset | USDT 335, USDC 23 |
| `contractSide` | 1 on every contract, linear | 358 |
| `deliveryKind` | `"0"` on every contract, perpetual | 358 |
| `multiplier`, `multiplierCoin` | contract size and its unit | 12 distinct sizes from 0.0001 to 10,000, unit equal to `base` on 357 |
| `capitalFrequency` | funding interval in hours | 8 on 91, 4 on 260, 1 on 7 |
| `nextCapitalSettTime` | next settlement, Unix ms | 1790150400000, 2026-09-23 08:00 UTC, on 351, and 1790139600000, 05:00 UTC, on 7 |
| `coinResultVo.depthList` | book steps, the first equal to the price tick | 358 of 358 |
| `coinResultVo.fundsInStatus`, `fundsOutStatus` | 1 on every contract | no other status field exists |
| `maxLever` | | 10 to 200 |

No field marks a contract as halted or delisting, so the list appears to hold only live contracts.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no Bitbaby class, and neither does CCXT master, see [`fees.md`](./fees.md) section 8.
The engine's catalog is `loadMarkets` from CCXT filtered to active swaps at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 68 and 195 to 202, so Bitbaby cannot enter it without a custom catalog loader.
If one were written, these are the mappings it would need.

| engine field | Bitbaby source | note |
|---|---|---|
| `rawMarketId` | `contractName`, or `subSymbol` | the socket speaks `subSymbol`, the anchor call speaks `id`, so the loader needs a map between the three |
| `base`, `quote` | `base`, `quote` | |
| `linear` | true | `contractSide` 1 everywhere |
| `contractSize` | `multiplier` | the socket's sizes are contracts, see [`websocket.md`](./websocket.md) section 4 |
| `active` | presence in the list | no status field |

### Size unit, pairs listed twice, and price scale

- `E-CHIP-USDT` is the one contract whose `multiplierCoin` is `USDT` rather than its base, with `multiplier` 0.1, P1.
  Its index read 0.04675 against Binance `CHIPUSDT` at 0.04667, so the price is per CHIP, and the size unit of this one contract is Not verified.
- 23 bases are listed twice, once against USDT and once against USDC, P1.
  The quote family treats them as one pair, so the engine would need a `marketFilter` to keep one, see [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
- No base carries a `1000` prefix, and the `E-IOTX-USDT` index read 0.003877 against Binance's 0.00387575, P2, so no price scale was seen.
- Two contracts carry the catalog tag `Tradfi`: `E-XAU-USDT`, also tagged precious metals, and `E-PAXG-USDT`, P1.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `POST /futures/api/common/public_market_info` with `{"contractId":1}` | `indexPrice` | `tagPrice` | `currentFundRate` and `nextFundRate` | absent | absent | one contract | median 125 to 128 ms |
| `POST /futures/api/common/public_info_v2` with `{}` | absent | absent | absent | `capitalFrequency`, hours | `nextCapitalSettTime`, Unix ms | 358 contracts, 358 KB | 1.6 to 2.7 s |
| socket `market_<subSymbol>`, see [`websocket.md`](./websocket.md) section 2 | `index_price` | `sign_price` | `last_fund_rate_third`, `funding_rate_next`, `funding_rate_last` | absent | absent | one frame per contract per change | half the contracts silent over 10 s |

No call returns index, mark and funding for every contract at once.
`public_market_info` rejects `{}`, a `symbol` and a list of ids with code `200004` `Invalid parameter`, and an unknown id returns `"data": null`, so a round over 358 contracts is 358 requests.
The socket's ticker channel carries every contract on one connection, but its worst silence per contract was a median 10.0 and 11.4 s, p90 25.5 and 32.0 s, and at most 48.2 and 53.0 s in two 60 s runs, and 180 and 197 of 358 contracts went more than 10 s without a frame, P3.
The engine refuses an anchor reading older than 10 s at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 5, so the ticker would leave about half the catalog unjudged.

### Row mapping

A mapping for a later design, if a poller were ever written.

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `id` in the request, mapped to `contractName` | integer | the loader's map |
| `index` | `indexPrice` | JSON number | none |
| `mark` | `tagPrice` | JSON number, never 0 on the three contracts polled | none |
| `fundingRate` | `currentFundRate` | JSON number, a fraction per interval | none, but which rate Bitbaby charges is Not verified, section 4 |
| `fundingIntervalHours` | `capitalFrequency` from the catalog | integer hours | none |
| `nextFundingAt` | `nextCapitalSettTime` from the catalog | Unix ms | none |

## 4. Anchor semantics

### Index

The ChainUp help center that Bitbaby's configuration links says the index weights OKX, Huobi and Binance at 33.3 % each for `BTCUSDT` and `ETHUSDT`, samples every second, drops a source not updated in 40,000 ms, and clips a source more than 3 % from the median, S1.
No basket is published for any other contract, and no basket call was found.
Bitbaby's index against Binance USD-M `indexPrice`, read in the same loop every 2 s for 60 s, P2:

| contract | index minus Binance index, ppm, run 2 |
|---|---|
| `E-BTC-USDT` | min -21, median 162, max 867 |
| `E-ETH-USDT` | min 156, median 816, max 1,566 |
| `E-IOTX-USDT` | min -1,785, median -1,334, max 913 |

The two reads were sent together and each took 100 to 550 ms, so part of each difference is timing.
The first run's first sample read BTC at 87,072.03 against Binance's 87,208.20, about -1,560 ppm.

### Mark

The help center gives mark = median(latest price, reasonable price, moving average price), where the reasonable price is the index times one plus the last rate scaled by the time left in the interval, and the moving average price is the index plus a 5 minute moving average of the mid minus the index, S1.
No clamp on the mark is published.

| contract | REST `tagPrice` minus `indexPrice`, ppm, run 2 |
|---|---|
| `E-BTC-USDT` | 0 on 30 of 30 polls |
| `E-ETH-USDT` | -438 to -387 |
| `E-IOTX-USDT` | 2,835 to 3,612 |

On BTC the REST mark equalled the index on every poll of the second run and on the first sample of the first run.
The socket's `sign_price` did not: the ticker frame at 04:39:42 UTC read 87,077.957 against an index of 87,088.671, about -123 ppm, see [`websocket.md`](./websocket.md) section 6.
So the REST `tagPrice` of BTC is not the mark the socket publishes, and a poller that read it would see a BTC premium of zero.

### Funding

| field | where | observed |
|---|---|---|
| `currentFundRate` | REST | equal to the socket's `last_fund_rate_third`. Within -3 to -2 ppm of Binance `lastFundingRate` on BTC, 0 on ETH, and -22 to -1 on IOTX, over two runs of 30 polls. It changed 0 times in 60 s on BTC and ETH and twice on IOTX in run 1 |
| `nextFundRate` | REST | equal to the socket's `funding_rate_next`. It differed from `currentFundRate` on 30 of 30 polls of every contract, and read 0.00008 on BTC throughout |
| `funding_rate_last` | socket | 0.00008 on BTC and 0.0001 on IOTX in the captured ticker frames. Binance's last settled BTC rate, at 2026-09-23 00:00 UTC, was 0.00001021, P1, so it is not that, and its meaning is Not verified |
| `admin_fund_rate_source` | socket | `"\"third\""` on every ticker frame, section 3 |

The documented formula is in [`fees.md`](./fees.md) section 6.
The wire suggests Bitbaby copies its current rate from a third venue, very likely Binance, and whether it settles on that rate or on `nextFundRate` is Not verified.
`/futures/api/common/funding_rate_history` answered code `200002` `System error`, and no other funding history call was found, so the settlement instant was not captured.

### How often each number changed

Over 29 intervals of 2 s, P2:

| contract | `indexPrice` | `tagPrice` | `currentFundRate` | `nextFundRate` |
|---|---|---|---|---|
| `E-BTC-USDT` | 24 and 23 | 24 and 23 | 0 and 0 | 0 and 0 |
| `E-ETH-USDT` | 24 and 22 | 24 and 22 | 0 and 0 | 14 and 0 |
| `E-IOTX-USDT` | 20 and 16 | 21 and 10 | 2 and 0 | 14 and 10 |

## 5. REST book snapshot

None was found.
`POST /futures/api/common/depth` answered code `200002` `System error`, and the bundle names no depth call, so the socket is the only book source, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

No limit is published, and no reply carried a rate limit header or `Retry-After`, P1.
No request was refused over a few hundred requests, sent one at a time and never more than about 3 per second.

Every error seen came back as HTTP 200 with a non-zero `code` string.

| code | message | when |
|---|---|---|
| `10020` | `Parameter error` | `get_level_fee_config_list` without `type` |
| `200002` | `System error` | an unknown path under `/futures/api/common/`, such as `depth` or `funding_rate_history` |
| `200004` | `Invalid parameter` | `public_market_info` without a numeric `contractId` |
| `200008` | `Method not allowed` | a `GET` on `public_info_v2`, and a `POST` on `gainers-list` |
| `0` with `"data": null` | `Success` | `public_market_info` with an unknown `contractId` |

## 7. Server time and clock offset

No time call was found.
`public_info_v2` carries `currentTimeMillis` and `sysTime`, which read 741 to 998 ms ahead of the local midpoint of the request in four runs.
Each of those requests took 1,699 to 2,217 ms, so the true offset is somewhere within about 1 s either side and cannot be resolved from this call.
The socket's ping carries whole Unix seconds, which is no finer.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

No REST poller fits the engine as it stands.
The anchor poller expects one bulk reply per round at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) line 103, and Bitbaby has none.

| option | what it takes | why it falls short |
|---|---|---|
| `public_market_info` per tracked contract every second | 358 requests a second for the whole catalog, or one per tracked contract | no published limit to size it against, and the BTC `tagPrice` equals the index |
| the socket ticker for index, mark and rate, plus `public_info_v2` every 60 s for interval and next settlement | an anchor fed from a socket, which the engine does not have | 180 to 197 of 358 contracts went over 10 s without a ticker frame, so they would read as stale |
| skip | the whole venue | no documented API, no CCXT class, and a site that classifies this host as a US address |

The documented surface is gone, and what remains is the website's private backend, so the verdict for the survey is no public API.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChainUp futures help center, Index Price, Mark Price, Funding Rate | https://futuresdoc.gitbook.io/help-center/perpetual/overview/index-price.md | 2026-09-22 | ChainUp white label, linked from Bitbaby's `contractProInfo` | index basket and rules, mark formula, section 4 |
| S2 | WebFetch of the documentation URL | https://docs.bitbaby.com/en/ | 2026-09-22 | Bitbaby | 404 from outside this host, section 1 |
| S3 | Wayback Machine CDX query | https://web.archive.org/cdx/search/cdx?url=docs.bitbaby.com*&output=json | 2026-09-22 | Internet Archive | no capture of the documentation, section 1 |
| S4 | Bitbaby web app JavaScript bundle | https://static.bitbaby.com/_next/static/chunks/ | 2026-09-22 | Bitbaby | `web-api.bitbaby.com` base URL, `POST` paths, sections 1 to 3 |
| P1 | `rest-probe.mjs catalog`, runs at 04:32, 04:38, 04:44 and 04:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbaby/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 6 and 7 |
| P2 | `rest-probe.mjs anchor`, runs at 04:33 and 04:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbaby/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 3 and 4 |
| P3 | `ws-probe.mjs tickers`, runs at 04:34 and 04:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbaby/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | ticker silence per contract, section 3 |
