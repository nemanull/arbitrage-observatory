# BitDelta REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:27 to 03:53 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public REST surface of BitDelta for its derivatives, which the venue's terms call perpetual contracts.
The public API documentation is a Postman collection of spot calls, S1, and names no derivatives call.
The derivatives calls below are the ones the venue's own trade page makes for a visitor who is not logged in, found in its script bundle, S2, and read by [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs).
They are undocumented, carry no stability promise, and are labelled as such.
The short answer is that BitDelta publishes no index, no mark and no funding rate series for its derivatives, so no anchor poller can be built.

## 1. Host and latency from this machine

| host | resolved on 2026-09-22 | served by |
|---|---|---|
| `api.bitdelta.com` | `104.20.41.198`, `172.66.167.6`, `2606:4700:10::ac42:a706`, `2606:4700:10::6814:29c6` | Cloudflare, `cf-ray` suffix `YVR`, `cf-cache-status: DYNAMIC`, `cache-control: no-store`, brotli bodies |
| `bitdelta.com` | `64.239.109.1` | the website |
| `public-api.bitdelta.com` | named by S1 as the base for public calls, and every example under it is a private call. `https://public-api.bitdelta.com/open/api/v1/pairs` answered 404 from nginx. | |
| `help.bitdelta.com` | | 403 with `cf-mitigated: challenge` |

| call | cold | warm, 5 requests | reply |
|---|---:|---|---:|
| `GET https://api.bitdelta.com/api/v1/futures/market/snapshot`, undocumented | 799 and 801 ms | min 395, median 405 and 406, max 434 ms | 73.6 KB |
| `GET https://api.bitdelta.com/open/api/v1/ticker`, documented, spot | 208 and 205 ms | min 200, median 205 and 374, max 378 ms | 56.1 KB |

The numbers are from the two runs of P1.
The derivatives snapshot took 405 and 406 ms at the median, against 205 and 374 ms for the documented spot ticker of similar size.

## 2. Catalog

### The instruments call

`GET https://api.bitdelta.com/api/v1/futures/market/snapshot`, undocumented, S2 and P2.
It returns the usual envelope, whose `data` holds `categories`, `chart_resolutions` and a `futures` array with one row per contract.

| count | value on 2026-09-22 |
|---|---|
| contracts | 90 |
| by category | `Top-10` 10, `Cryptos` 64, `Cross-Cryptos` 16 |
| by quote (`currency2`) | USD 74, BTC 4, ETH 4, LTC 4, BCH 4 |
| by `status`, read per contract from `futures/market/pair` | `Active` 89, `Not active` 1 (`STOUSD`), while `active` is true on all 90 |
| `max_leverage` | 100 on 10 contracts (`BTCUSD`, `ETHUSD`, `SOLUSD`, `XRPUSD`, `BNBUSD`, `ADAUSD`, `LNKUSD`, `LTCUSD`, `NERUSD`, `TRXUSD`), 10 on the other 80 |

The snapshot row carries `symbol`, `id`, `currency1`, `currency2`, precisions, `category`, `slug`, `standard_symbol`, `bid`, `ask`, `price`, a 24 point `pricing` array, `change`, `ismarketclosed`, leverage fields, `high` and `low`.
It carries no status, no size limits and no fee fields.
Those come from `GET https://api.bitdelta.com/api/v1/futures/market/pair?slug=btc-usd`, or `?symbol=BTCUSD`, one contract per call of 1.4 to 1.7 KB answered in 197 to 257 ms, median 202 ms, P2, which adds `status`, `min_amount`, `max_amount`, `step`, `spread`, commissions, funding fees and liquidation fees, see [`fees.md`](./fees.md).
Without a slug or symbol it answers 400 `value must contain at least one of symbol,slug`.

### How CCXT 4.5.68 maps it

It does not.
No CCXT class exists for BitDelta in 4.5.68 or in current master, see [`fees.md`](./fees.md) section 8.
A connector would have to build the catalog itself, and the engine's catalog path, `loadMarkets` filtered by `isActiveSwapMarket` at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196, has no BitDelta markets to filter.

### Symbols

The symbol is six letters, and on 21 contracts it does not spell the base asset: `NERUSD` is NEAR, `ATMUSD` ATOM, `SANUSD` SAND, `SUSUSD` SUSHI, `INCUSD` 1INCH, `ALGUSD` ALGO, `AVAUSD` AVAX, `DOGUSD` DOGE, `DSHUSD` DASH, `IOTUSD` IOTA, `LNKUSD` LINK, `SHBUSD` SHIB, `BARUSD` HBAR, `MANUSD` MANA, `TETUSD` THETA, `AAVUSD` AAVE, `FLWUSD` FLOW, `GALUSD` GALA, `COMUSD` COMP, `ALIUSD` ALICE and `IOSUSD` IOST, P2.
On 12 more contracts `currency1` is truncated too, and only `standard_symbol` spells the asset: `VECUSD` is VET, `CEOUSD` CELO, `KAVUSD` KAVA, `ARWUSD` AR, `QTMUSD` QTUM, `COTUSD` COTI, `EGLUSD` EGLD, `PEPUSD` PEOPLE with `currency1` `PEP`, `CNEUSD` C98, `DYDUSD` DYDX, `ANKUSD` ANKR and `STOUSD` STORJ, P2.
So `PEPUSD` is PEOPLE and not PEPE, which is the kind of name clash `DENIED_PAIRS` exists for.
The socket keys on `symbol`, see [`websocket.md`](./websocket.md) section 3, so a mapping would take `symbol` as the id and strip the quote from `standard_symbol` for the base.

### Size unit, pairs listed twice, and price scale

| contract | `min_amount` | `max_amount` | `step` | price |
|---|---:|---:|---:|---:|
| `BTCUSD` | 0.01 | 10 | 0.01 | 86,666 |
| `ETHUSD` | 0.05 | 135 | 0.01 | 2,766 |
| `SOLUSD` | 5 | 11,210 | 1 | 118.87 |
| `SHBUSD` | 9,993,510 | 199,870,084 | 1 | 0.00000617 |
| `BTCETH` | 0.01 | 9 | 0.01 | 31.34 |

The unit is Not publicly specified.
The values fit base asset units, since `SHBUSD` needs millions and `BTCUSD` hundredths, which is an inference.
No contract is quoted per 10 or per 1000 units, and no pair is listed twice.
The 16 cross contracts carry `quotetype` `m` and a `quotesymbol` such as `BTCUSD` for `BCHBTC`, which the page uses to convert the coin quote to USD.

### Spot, for comparison

The documented `GET https://api.bitdelta.com/open/api/v1/pairs` lists 387 spot pairs, all `trading`, 378 quoted in USDT and 9 in USDC, 360 KB, P2.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `futures/market/snapshot`, undocumented | absent | absent. `price` is the mid of `bid` and `ask` | absent | absent | absent | 73.6 KB, 90 rows | 60 polls at 1 s: min 250, median 414, p90 435, max 868 ms, and min 241, median 406, p90 423, max 784 ms in the rerun, none over 1 s, P3 |
| `futures/market/pair?slug=`, undocumented, one contract per call | absent | absent | `buy_funding_fee` and `sell_funding_fee`, a daily percent per side, see [`fees.md`](./fees.md) section 6 | absent | absent | 1.4 to 1.7 KB | median 202 ms, P2 |

BitDelta publishes no index price, no mark price and no funding rate in the sense the engine uses.
The trade page's text has keys named `main_index`, `sub_index` and `mid_price`, S2, and no call or event that the page makes returns an index value.
The one number per contract is a two-sided quote and its mid.

### Row mapping

| `AnchorRow` column | field | note |
|---|---|---|
| key | `symbol` | six letters, section 2 |
| `index` | none | Not publicly specified |
| `mark` | none | the engine reads a mark of 0 as "the venue publishes none" and refuses the route at open, [`types.ts`](../../../server/src/engine/cluster/types.ts) line 34 |
| `fundingRate` | none. The per side funding fee is a daily holding charge that is negative for both sides, not a rate that longs pay to shorts | |
| `fundingIntervalHours` | 24, from the page's text only | [`fees.md`](./fees.md) section 6 |
| `nextFundingAt` | 00:00 UTC or 12:00 UTC, the page's two tooltips disagree | [`fees.md`](./fees.md) section 6 |

## 4. Anchor semantics

| item | value | label |
|---|---|---|
| index formula and basket | none published | Not publicly specified |
| basket call | none | Not publicly specified |
| mark formula and clamps | none published. The only price is the quote's mid, `(bid + ask) / 2` rounded to the price precision | Probed, [`websocket.md`](./websocket.md) section 4 |
| funding formula and cap | none published. The funding fee is a flat daily percent per contract, equal on both sides | Probed, P2 |
| upcoming or last settled | Not publicly specified | |
| funding history | no public call | Not publicly specified |
| source of the quote | the liquidity page says the platform aggregates "liquidity from various providers in parallel", S3, while the derivative terms say the venue is not a counterparty or market maker, see [`fees.md`](./fees.md) section 7 | Published |

How often each number changed between 59 pairs of consecutive polls of the snapshot at one second, in two runs, P3.

| contract | bid changed | ask changed | `price` changed |
|---|---:|---:|---:|
| `BTCUSD` | 57 and 55 | 57 and 43 | 59 and 55 |
| `BTCETH` | 52 and 53 | 52 and 45 | 54 and 52 |
| `ZENUSD` | 21 and 26 | 20 and 22 | 22 and 27 |
| `ETHUSD` | 20 and 38 | 20 and 38 | 20 and 39 |
| `SOLUSD` | 19 and 22 | 19 and 22 | 19 and 22 |
| `IOSUSD` | 3 and 7 | 3 and 9 | 3 and 7 |
| `SNXUSD` | 0 and 0 | 0 and 0 | 0 and 0 |
| all 90, median | 8 and 9 | | 7 and 9 |

The socket delivers the same quotes at about 9 a second on the busiest contracts, so a REST poll adds nothing the socket lacks, see [`websocket.md`](./websocket.md) section 4.

## 5. REST book snapshot

No derivatives book exists over REST.
The documented `GET https://api.bitdelta.com/open/api/v1/orderbook?symbol=BTCUSD&level=2&depth=50` answered 400 `Invalid symbol`, and so did the documented `summary` and `trades` calls for `BTCUSD`, P4.

The spot book answers outside the usual envelope, as an object with `timestamp` in Unix ms and `bids` and `asks` arrays of string pairs such as `["86706.8","0.42985"]`, bids descending and asks ascending, P4.
It returned 10 levels per side for `depth=50` and for `depth=20` at 03:37 and at 03:44 UTC.
Twenty seconds before the first of those, the same call returned three bids, at `70000`, `57278` and `57251`, against asks from `86703.3`, which is a hollow bid side on the venue's largest spot pair.
Spot is outside this survey's scope, so this was not followed up.

## 6. Rate limits and errors

S1 says the `/api/v1/*` endpoints "share the 2500 per 5 minute limit based on IP", that a 429 is followed by an IP ban answered with 418 for repeat offenders, "from 2 minutes to 3 days", and that "A retry-after header is sent with a 418 or 429 response".
Whether the undocumented `futures/*` calls count against that limit is Not publicly specified.
No reply carried a rate limit header, and no 429 or 418 was seen at up to about two requests a second, P2 and P3.

| request | status | body |
|---|---:|---|
| `futures/market/pair?slug=nope-usd` | 400 | `{"statusCode":400,"data":"","message":"Invalid symbol","statusText":"BAD_REQUEST","timestamp":"2026-09-23T03:37:24.147Z","isFormError":false,"displayType":"TOAST"}` |
| `futures/market/pair` with no slug | 400 | `message` `value must contain at least one of symbol,slug` |
| `api/v1/market/snapshot`, the website's spot snapshot | 404 | `message` `API Key not provided`, `statusText` `NOT_FOUND` |
| `open/api/v1/summary?symbol=NOPEUSDT` | 400 | `message` `Invalid symbol` |
| `open/api/v1/nope` | 404 | `Not Found` as plain text |

The envelope carries `statusCode`, `data`, `message`, `statusText` and `timestamp`, as S1 documents, with `isFormError` and `displayType` added on errors.

## 7. Server time and clock offset

No server time call is documented.
The envelope `timestamp` is an ISO string in ms.
Over five requests it read 3 to 50 ms ahead of the local midpoint, median 6 ms, with round trips of 198 to 302 ms, P1.
In the rerun four warm requests read 7 to 9 ms, and the first request, with a 671 ms round trip that includes the connection setup, read 230 ms.
The `Date` header agreed to the second.

## 8. Recommended poller shape

None.
No call returns an index, a mark or a funding rate, so every `AnchorRow` would carry a mark of 0 and the engine would refuse every BitDelta route at open, as [`types.ts`](../../../server/src/engine/cluster/types.ts) line 34 describes.
The per side funding fee could be read once a day from 90 calls to `futures/market/pair`, but it is a holding charge on both sides and not a rate between longs and shorts, so it does not fit `fundingRate`.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitdelta Public API, a Postman collection published 2024-04-04 | https://api-docs.bitdelta.com/, collection at https://api-docs.bitdelta.com/api/collections/29064556/2s9Xy3rWSo | 2026-09-22 | BitDelta, global | base URLs, spot calls, envelope, error codes, rate limit, sections 1, 5 and 6 |
| S2 | Derivatives trade page and its script bundle under `/derivatives/_next/static/chunks/` | https://bitdelta.com/en/trade/derivatives/btc-usd | 2026-09-22 | BitDelta, global | the undocumented `futures/market/snapshot`, `futures/market/pair` and `futures/orderbook-v2` paths, the page's text keys, sections 2 to 4 |
| S3 | Liquidity page | https://bitdelta.com/en/liquidity | 2026-09-22 | BitDelta, global | liquidity providers, section 4 |
| P1 | `rest-probe.mjs host` and `time`, 03:34 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs) | 2026-09-22 | this host | sections 1 and 7 |
| P2 | `rest-probe.mjs catalog`, 03:35 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs) | 2026-09-22 | this host | section 2 |
| P3 | `rest-probe.mjs poll`, 03:36 and 03:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P4 | `rest-probe.mjs book` and `errors`, 03:37 and 03:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs) | 2026-09-22 | this host | sections 5 and 6 |
