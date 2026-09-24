# CrypFine REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 06:34 to 06:46 UTC, from the development host near Seattle through its Canadian VPN exit, and every documented API path was refused with HTTP 403.

This profile covers the public REST API of the CrypFine USDT perpetuals, which CCXT 4.5.68 does not implement.
No documented call returned data to this host, so the catalog, anchor and book sections record the documented contract and the refusal.
The probe is [`rest-probe.mjs`](../../../scripts/probes/venues/crypfine/rest-probe.mjs), which calls each documented public path once cold and once warm, one second apart.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| base, perpetuals | `https://openapi.crypfine.com/backend/exchange/swap/` | S1 |
| base, spot | `https://openapi.crypfine.com/backend/exchange/spot/` | S8 |
| DNS | `openapi.crypfine.com`, `ws-openapi.crypfine.com` and `www.crypfine.com` are each a CNAME to `<host>.cdn.cloudflare.net`, resolving to `104.18.24.150` and `104.18.25.150` | P1 |
| edge | Cloudflare `/cdn-cgi/trace` answered 200 with `loc=CA` on both API hosts, from colo `SEA` or `YVR`, which swapped between runs | P1 |
| access | the Surfshark WireGuard exit of this laptop geolocates to Canada, so every result here is from that Canadian exit and not from a US address | P1 |

What each path returned to this host, over the three runs of P1.

| path | status | time | body |
|---|---|---|---|
| every documented call under `/backend/exchange/swap/` and `/backend/exchange/spot/`, eight calls, cold and warm | 403 | 11 to 39 ms | Cloudflare block page, `Attention Required! \| Cloudflare`, "Sorry, you have been blocked" |
| `/backend/exchange/swap/` and `/backend/exchange/spot/` with no call | 403 | 13 to 19 ms | the same block page |
| `openapi.crypfine.com/`, `/backend/exchange/` and `/backend/exchange/stream/ws` | 200 | 209 to 725 ms | `{"code":403,"message":"禁止访问 ！！！"}`, JSON from the origin, "access forbidden" |
| `ws-openapi.crypfine.com/` and its documented socket path, plain GET | 403 | 17 to 41 ms | the block page |
| `www.crypfine.com/openapi-docs/usdt_perpetual/`, same zone | 200 | 253 to 421 ms | the documentation page |

The 403 on the API paths comes back in about 20 ms, which is the edge answering without the origin.
The zone serves its documentation to the same exit, and paths outside the two API prefixes reach the origin, so the rule is scoped to the API paths and the socket host rather than to the whole zone or the whole country.
The origin itself answers `禁止访问` on every path it was shown.
The documents explain both: "You must apply for a whitelist to access all APIs!", S2, and the change log of 2026-05-13, "Update our firewall rules. All clients should be added into whitelist so that they can visit the API.", S3, repeated in the spot change log, S8.
A single exit cannot tell an allow-list rule from a country rule, and Canada is also an Excluded Jurisdiction, see [`fees.md`](./fees.md) section 1.
No route around the refusal was tried.

The web trading app calls relative `/backend/exchange` and `/api/...` paths on `www.crypfine.com`, as its bundles on `static.crypfine.mobi` show.
Those paths are undocumented and were not called, because using them to read what the API refused would be a route around the refusal.

Cold and warm times cannot be compared, since neither reached the origin.

## 2. Catalog

### The instruments call

| item | documented | probed |
|---|---|---|
| call | `GET /api/usdt/instruments/list`, no parameters, 3 per second, S4 | 403 in every run |
| fields | `contract_code` (`BTC-SWAP`), `multiplier` (contract value in base coin), `min_amount`, `max_amount`, `min_price_change`, `price_precision`, `leverages`, `max_leverage`, S4 | |
| status field | none documented, so an inactive or delisted contract cannot be told apart from the reply | |
| settlement | USDT only | |

The active perpetual count could not be read from the venue.
CoinMarketCap's exchange page on 2026-09-23 at 06:12 UTC listed 31 USDT perpetuals, each linking to `https://www.crypfine.com/contract/futures/<id>`, S9.
Those ids were `BTC-SWAP`, `ETH-SWAP`, `XRP-SWAP`, `SOL-SWAP`, `DOGE-SWAP`, `HYPE-SWAP`, `BNB-SWAP`, `NEAR-SWAP`, `UNI-SWAP`, `1000PEPE-SWAP`, `BCH-SWAP`, `SUI-SWAP`, `LTC-SWAP`, `TRUMP-SWAP`, `LINK-SWAP`, `AVAX-SWAP`, `ADA-SWAP`, `TRX-SWAP`, `AAVE-SWAP`, `WIF-SWAP`, `ETC-SWAP`, `TAO-SWAP`, `INJ-SWAP`, `OP-SWAP`, `DOT-SWAP`, `SEI-SWAP`, `ETHFI-SWAP`, `ARB-SWAP`, `1000BONK-SWAP`, `1000SHIB-SWAP` and `GOLD(XAUT)-SWAP`.
The survey brief quotes CoinMarketCap's derivatives ranking the same day at 28 pairs.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 lists no CrypFine id, and the current master has no `crypfine.ts`, see [`fees.md`](./fees.md) section 8.
The engine's catalog is `loadMarkets` filtered to active swaps, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68 and 79, so CrypFine would need a hand-written catalog loader, the named change in the verdict.

### Size unit, pairs listed twice, and price scale

The `multiplier` is the base coin per contract, `0.01` for `ETH-SWAP` and `0.001` for `BTC-SWAP` in the example, S4, and 0.1 HYPE for `HYPE-SWAP` in its listing notice, S10.
Book sizes are in contracts, as far as the REST depth example shows, see [`websocket.md`](./websocket.md) section 3.
The `1000PEPE`, `1000BONK` and `1000SHIB` ids name a thousand-unit base, which would need the price scale of `clusterOverrides.ts` or a base rename.
`GOLD(XAUT)-SWAP` names tokenized gold under a label other venues do not use, so it would need a mapping or a `DENIED_PAIRS` line.
No pair is listed twice in CoinMarketCap's table.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | probed |
|---|---|---|---|---|---|---|
| `GET /api/usdt/instruments/ticker_list`, 3 per second, S5 | absent | `mark_price` | absent | absent | absent | 403 |
| `GET /api/usdt/instruments/ticker_one?instrument_id=BTC-SWAP`, S5 | absent | `mark_price` | absent | absent | absent | 403 |
| `GET /api/usdt/instruments/funding_rate?instrument_id=BTC`, one contract per call, 3 per second, S6 | absent | absent | `funding_rate` | absent | absent | 403 |
| WebSocket `usdt/ticker.all`, S7 | `indexPrice` | `markPrice` | `fundingRate` | absent | absent | refused |

No REST call returns the index.
The funding rate is per contract only, so 31 contracts at 3 calls per second would take about 10 s per round, over the engine's 10 s age limit at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) line 5.
The only bulk source of all three prices is the WebSocket ticker topic, which the engine's REST [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) does not consume.
The funding interval and next settlement are not in any reply, and would come from the documented fixed schedule of 00:00, 08:00 and 16:00 UTC, see [`fees.md`](./fees.md) section 6.
The `funding_rate`, `ticker_one` and `depth` calls all describe `instrument_id` as a "Contract abbreviation, such as BTC, ETH, BCH, BSV", while their replies and the socket topics spell the contract `BTC-SWAP`, S5, S6 and S13, so the parameter form would have to be settled on the wire.

### Row mapping

A mapping for reference only, since nothing answered.

| `AnchorRow` column | field | unit |
|---|---|---|
| key | `symbol` on the socket, `contract_code` on REST | `BTC-SWAP` |
| `index` | `indexPrice`, socket only | decimal string |
| `mark` | `mark_price` or `markPrice` | decimal string |
| `fundingRate` | `funding_rate` or `fundingRate` | decimal string, a fraction per 8 h interval as far as the Funding Fee article reads, `"0.000236"` in the example |
| `fundingIntervalHours` | none, 8 from the Funding Fee article | |
| `nextFundingAt` | none, the next of 00:00, 08:00 and 16:00 UTC | |

## 4. Anchor semantics

| item | documented | source |
|---|---|---|
| index | "HYPE / USDT Index" is named as the underlying, and the basket, weights and constituent venues are Not publicly specified. No basket call exists | S10 |
| mark | median of Price1, Price2 and the latest futures trade price | S11 |
| Price1 | Index times (1 + Latest Funding Rate times (Time Until Next Funding / Funding Interval)), with the time rounded down to whole hours | S11 |
| Price2 | Index + the 2 minute moving average of (mid minus index), sampled every 5 s, 24 samples | S11 |
| mark clamp | none published beyond the median | S11 |
| funding | F = P + clamp(I minus P, 0.05 %, minus 0.05 %), with an absolute cap and a change cap tied to the margin rates | S12 |
| upcoming or settled | Not publicly specified. The call is described as "Get the latest funding rate of the current contract" | S6 |

The median-of-three mark includes the last futures trade, so on a thin contract the mark can equal the venue's own last trade, the shape the self-index research warns about, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
How often each number changes over a minute of polls could not be measured.
CoinMarketCap's pair table on 2026-09-23 at 06:12 UTC shows an index basis between minus 1,372 and plus 1,668 ppm across the 31 contracts, S9, which is third-party data and not a reading from the venue.

## 5. REST book snapshot

| item | documented | probed |
|---|---|---|
| call | `GET /api/usdt/instruments/depth?instrument_id=BTC-SWAP&depth=100`, 10 per second, S13 | 403 in every run |
| depth | 5, 10, 50 or 100, default 10 | |
| level shape | `[price, quantity, order count]`, all strings | |
| order | the example lists asks ascending and bids descending | |
| caching | Not publicly specified | |

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| limit key | the user id when a valid API key is sent, the public IP otherwise | S14 |
| limits | `instruments/list`, `ticker_one`, `ticker_list`, `funding_rate`, `trade_list` and `candles` at 3 per second since 2026-03-17, down from 10. `depth` at 10 per second. Server time at 5 per second | S3, S4 to S6, S13, S15 |
| over the limit | HTTP 429, "Request too frequently" | S14 |
| `Retry-After` | Not publicly specified, and none seen, since no reply came from the origin | P1 |
| error shape | `{"code": 10001, "msg": "Invalid Paramater."}`, while success replies use `{"code": 200, "message": null, "data": ...}` | S1, S4 |
| 504 | "does not mean that the request failed, but is unknown" | S16 |
| refusal seen here | HTTP 403, `text/html`, 4,547 bytes of Cloudflare block page, no `cf-mitigated` header, no `Retry-After` | P1 |

The engine counts 403 as a rate limit, at [`errors.ts`](../../../server/src/shared/errors.ts) line 1, and pauses on it at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 194.
So a poller aimed at this host would pause, retry and pause again without end.

## 7. Server time and clock offset

`GET /api/v1/usdt/time`, 5 per second, returns `{"iso": "2023-04-11T08:30:09.956Z", "epoch": "1681201809.956"}` in the documented example, with `epoch` a string of seconds, S15.
It returned 403 to this host, so the clock offset was not measured.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
Do not build a poller, and do not add the venue.

| item | recommendation | reason |
|---|---|---|
| access | none from this host | every documented path answers 403, and the documents require an allow-listed client |
| eligibility | none for this operator | the United States and Canada are Excluded Jurisdictions, and futures API access needs KYC, an emailed application, and 5,000,000 USDT of futures volume per 14 days with at least half as maker, see [`fees.md`](./fees.md) section 5 |
| execution | incompatible | 300 trades a day, or 20 orders an hour less than 2 minutes apart, is classed as order brushing, see [`fees.md`](./fees.md) section 5 |
| catalog | a hand-written loader over `instruments/list` | no CCXT class, and the reply has no status field |
| anchor | the WebSocket `usdt/ticker.all` topic for index, mark and rate, with interval and next settlement from the fixed 8 h schedule | no REST call carries the index, and the per contract funding call would take about 10 s per round |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Base Endpoint | https://www.crypfine.com/openapi-docs/usdt_perpetual/general_info/base_endpoint/ | 2026-09-22 | Crypfine | base URLs, error shape, sections 1 and 6 |
| S2 | CrypFine USDT Perpetual API | https://www.crypfine.com/openapi-docs/usdt_perpetual/ | 2026-09-22 | Crypfine | whitelist notice, section 1 |
| S3 | Change Log | https://www.crypfine.com/openapi-docs/usdt_perpetual/usdt_changelog/ | 2026-09-22 | Crypfine | firewall entry of 2026-05-13, limits of 2026-03-17, sections 1 and 6 |
| S4 | Exchange Information | https://www.crypfine.com/openapi-docs/usdt_perpetual/public/exchange_info/ | 2026-09-22 | Crypfine | catalog call and fields, sections 2 and 6 |
| S5 | Ticker and Ticker List | https://www.crypfine.com/openapi-docs/usdt_perpetual/public/ticker_list/ | 2026-09-22 | Crypfine | mark field, no index, section 3 |
| S6 | Funding Rate | https://www.crypfine.com/openapi-docs/usdt_perpetual/public/funding_rate/ | 2026-09-22 | Crypfine | per contract rate call, sections 3 and 4 |
| S7 | WebSocket Ticker | https://www.crypfine.com/openapi-docs/usdt_perpetual/ws/ticker/ | 2026-09-22 | Crypfine | `indexPrice` on the socket, section 3 |
| S8 | Spot V2 Base Endpoint and Spot Change Log | https://www.crypfine.com/openapi-docs/spot/general_info/base_endpoint/ | 2026-09-22 | Crypfine | spot base URL, firewall entry, section 1 |
| S9 | CoinMarketCap exchange page `crypfine`, perpetual tab | https://coinmarketcap.com/exchanges/crypfine/?type=perpetual | 2026-09-23 06:12 UTC | CoinMarketCap, third party | pair list, basis, section 2 and 4 |
| S10 | HYPE Perpetual Trading Available Now | https://crypfine.zendesk.com/hc/en-001/articles/16646375271823 | 2026-09-22, published 2026-06-29 | Crypfine | face value, index name, sections 2 and 4 |
| S11 | Mark Price | https://crypfine.zendesk.com/hc/en-001/articles/12468463070223 | 2026-09-22, updated 2025-04-21 | Crypfine | mark formula, section 4 |
| S12 | Funding Fee | https://crypfine.zendesk.com/hc/en-001/articles/12468587361679-Funding-Fee | 2026-09-22, updated 2025-04-21 | Crypfine | funding formula, section 4 |
| S13 | Order Book | https://www.crypfine.com/openapi-docs/usdt_perpetual/public/depth/ | 2026-09-22 | Crypfine | REST book, sections 5 and 6 |
| S14 | Access Restriction | https://www.crypfine.com/openapi-docs/usdt_perpetual/general_info/access_restriction/ | 2026-09-22 | Crypfine | limit key and 429, section 6 |
| S15 | Check Server Time | https://www.crypfine.com/openapi-docs/usdt_perpetual/public/server_time/ | 2026-09-22 | Crypfine | time call, sections 6 and 7 |
| S16 | Error Codes | https://www.crypfine.com/openapi-docs/usdt_perpetual/usdt_errorcode/ | 2026-09-22 | Crypfine | HTTP error meaning, section 6 |
| P1 | `rest-probe.mjs`, runs at 06:37, 06:40 and 06:44 UTC on 2026-09-23, the last two with the path map | [`rest-probe.mjs`](../../../scripts/probes/venues/crypfine/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 3 and 5 to 7 |
