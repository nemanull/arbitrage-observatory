# Emirex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 04:23 and 04:46 UTC on 2026-09-23, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST API of Emirex (no CCXT class) on its spot market, since Emirex lists no perpetual, see [`fees.md`](./fees.md) section 3.
The documented API is small: four public GET calls under `https://api.emirex.com/v1/public/` and one candle call on the socket host, S1.
The web app uses a second, undocumented base, `https://api.emirex.com/api`, named `BASE_API_URL` in its bundle, S2, and two of its public calls are used below because they return every pair at once.
Every number was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/emirex/rest-probe.mjs) unless a source says otherwise.

## 1. Host and latency from this machine

| item | value |
|---|---|
| `api.emirex.com` | 104.26.14.90, 104.26.15.90 and 172.67.68.164, Cloudflare |
| `socket.emirex.com` | the same three addresses |
| Cloudflare edge | `cf-ray` ended in `SEA` or `YVR`, changing from one request to the next |
| cold request, `GET /v1/public/symbols`, new TLS connection each | 807, 690 and 214 ms, and 709, 232 and 215 ms in the rerun |
| warm request, same call, kept alive, 10 reads | min 188, median 192, max 734 ms, and min 176, median 178, max 209 ms in the rerun |
| bulk ticker, `GET /api/default/ticker`, 30 polls at 1 s | min 186, median 190, p90 198, max 291 ms, and 177, 180, 206 and 287 ms in the rerun, all 200 |

All results are from a host whose traffic leaves through a Canadian VPN exit.
No call was refused.

## 2. Catalog

### The instruments call

`GET https://api.emirex.com/v1/public/symbols` returns `{"status":true,"data":[{"id","pair","base","quote","rate_decimal","base_decimal","quote_decimal"}]}`, 1,328 bytes, 12 rows, S1 and P1.

| id | pair | id | pair |
|---|---|---|---|
| 261 | `BTCUSDC` | 801 | `DOTUSDC` |
| 271 | `USDCUSDT` | 811 | `BNBUSDC` |
| 591 | `LINKUSDC` | 821 | `BCHUSDC` |
| 751 | `ETHUSDC` | 831 | `ADAUSDC` |
| 761 | `SOLUSDC` | 841 | `LTCUSDC` |
| 781 | `DOGEUSDC` | 851 | `ALGOUSDC` |

`rate_decimal`, `base_decimal` and `quote_decimal` are 8 on every row.
The call carries no status field.
The bulk ticker `GET https://api.emirex.com/api/default/ticker` returns the same 12 pairs with `status` 0, `type` 0, `pair_type` null and `low_liquidity` 0 on every row, 13,247 and 13,218 bytes, P1.
Its creation times run from 2022-03-28 for `BTCUSDC` and `USDCUSDT` to 2025-04-21 for the last six pairs.
The pair name is the key in every public call, and the numeric `id` is the key of the socket rooms, see [`websocket.md`](./websocket.md) section 4.
`pair=btcusdc` in lower case is accepted, and `pair=BTC_USDC` answers 400 `{"status":false,"error":"Incorrect pair"}`, P1.

Active perpetual count: none.
Spot pairs: 11 quoted in USDC and 1, `USDCUSDT`, quoted in USDT.

### How CCXT 4.5.68 maps it

It does not, because CCXT 4.5.68 and CCXT master have no Emirex class, see [`fees.md`](./fees.md) section 8.
`market.id`, `contractSize`, `linear` and `active` therefore have no CCXT source.
A spot market needs no contract size: REST sizes are base currency and socket sizes are base currency in units of 1e-8, see section 5.
No pair is listed twice.

## 3. Anchor

Emirex publishes no index, no mark and no funding, since it lists no perpetual.
`GET /v1/public/fundingRate` and `GET /v1/public/markets` answer 404 with an HTML "Not Found (#404)" page, P1.

It publishes two reference prices, and neither is an index.

| call | what it returns | on 2026-09-23 |
|---|---|---|
| `GET /api/default/ticker` | `rate`, the last trade as an integer of 1e-8, and `main.rate_usd`, `rate_usdt`, `rate_btc`, `rate_eth` | `rate_usd` equalled `rate` on every USDC pair, and on `USDCUSDT` it read 1 against a `rate` of 1.0002, so it is a conversion of the venue's own last trade |
| `GET /v1/public/ticker?pair=BTCUSDC` | `last`, `high`, `low`, `volume_24H`, `percent_сhange` with a Cyrillic `с` in the key | `last` "87105.99000000" at 04:24 UTC |

No call returns a mark, and no `AnchorRow` column has a source.
A leg with a mark of 0 is refused at open, at [`types.ts`](../../../server/src/engine/cluster/types.ts) line 34 and [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) line 37.

## 4. Anchor semantics

Not applicable, because there is no index, mark or funding.
For context, the bulk ticker's `rate` changed at most once per pair in 29 one second intervals, on 5 pairs in the first run and on 10 in the rerun, P1.
The last 25 `BTCUSDC` trades in the rerun were 8 to 36 s apart, median 12 s, and each was 0.0001 to 0.00227 BTC, or 8.71 to 197.81 USDC, P1.
A pair that trades every 12 s and whose `rate` changed at most once in 30 s suggests the bulk ticker is refreshed less often than it trades, which is an inference.

The book stays close to Binance spot's price.
Over ten reads 2 s apart in each of two runs, the Emirex touch straddled Binance spot's touch on the same pair, P2.
Each cell is the median of the first run, then of the rerun.

| pair | Emirex bid against Binance bid, ppm | Emirex ask against Binance ask, ppm | Emirex spread, ppm | Binance spread, ppm |
|---|---|---|---|---|
| `BTCUSDC` | -239, then -387 | 482, then 334 | 758, then 721 | 0, then 0 |
| `ETHUSDC` | -604, then -891 | 1,431, then 726 | 2,104, then 1,486 | 4, then 4 |
| `SOLUSDC` | -368, then -511 | 854, then 603 | 1,391, then 1,197 | 84, then 84 |
| `DOGEUSDC` | -1,352, then -868 | 2,218, then 772 | 2,805, then 1,835 | 386, then 193 |

In the rerun every Emirex bid sat below Binance's bid, and in the first run the highest reading was 45 ppm above it on `BTCUSDC` and 67 ppm above it on `SOLUSDC`.
In both runs every Emirex ask sat above Binance's ask, by 192 ppm at least.

Every level of the `BTCUSDC` book carried `count` 1 in both runs, the longest silence of most book rooms was 5.0 to 5.2 s in both socket runs, and the trades are small and regular, see [`websocket.md`](./websocket.md) section 4.
That is the shape of one market maker quoting around another venue's price, which is an inference from these readings and not something Emirex states.

## 5. REST book snapshot

`GET https://api.emirex.com/v1/public/book?pair=<pair>` returns `{"status":true,"data":{"buy":[{"volume","rate","count"}],"sell":[…],"sequenceId"}}` with JSON numbers, `rate` in quote currency and `volume` in base currency, S1 and P1.

The table is the first run at 04:32 UTC, with the rerun's spread at 04:42 UTC in the last column.

| pair | bids | asks | spread, ppm | `sequenceId` | top 20 bid, quote | top 20 ask, quote | rerun spread, ppm |
|---|---:|---:|---:|---:|---:|---:|---:|
| `BTCUSDC` | 122 | 68 | 702 | 5,717,877 | 153,503 | 97,895 | 718 |
| `USDCUSDT` | 15 | 20 | 300 | 339,920 | 61,284 | 63,694 | 300 |
| `LINKUSDC` | 64 | 62 | 1,731 | 1,798,946 | 27,184 | 28,980 | 1,539 |
| `ETHUSDC` | 113 | 66 | 1,451 | 2,461,948 | 78,925 | 89,919 | 1,194 |
| `SOLUSDC` | 87 | 76 | 895 | 2,065,675 | 137,817 | 140,389 | 996 |
| `DOGEUSDC` | 71 | 64 | 4,325 | 2,357,786 | 52,316 | 42,399 | 2,603 |
| `DOTUSDC` | 118 | 94 | 2,236 | 3,223,680 | 17,785 | 21,030 | 1,750 |
| `BNBUSDC` | 97 | 75 | 1,718 | 2,591,342 | 73,027 | 70,786 | 1,367 |
| `BCHUSDC` | 43 | 41 | 6,355 | 795,537 | 48,785 | 14,798 | 3,580 |
| `ADAUSDC` | 151 | 45 | 1,565 | 2,918,156 | 25,261 | 24,634 | 1,386 |
| `LTCUSDC` | 86 | 57 | 4,595 | 2,790,811 | 22,900 | 15,921 | 3,057 |
| `ALGOUSDC` | 74 | 56 | 2,816 | 3,496,555 | 26,251 | 22,943 | 2,464 |

- Order: bids descending and asks ascending on all 12 pairs, 0 out of order levels, P1.
- Depth: the whole book, from 25,085.51 to 126,065.41 on `BTCUSDC`, so far levels sit at 0.29 and 1.45 times the price.
- `limit=5` returns 5 levels per side, while `depth=5` and `size=5` are ignored, in both runs, P1.
- `sequenceId` is per pair, and it is the same counter the socket room carries, so a REST book seeds a socket feed exactly, see [`websocket.md`](./websocket.md) section 4.
- Caching: `cf-cache-status: DYNAMIC` and no `cache-control` header.
  Two back-to-back reads returned the same body and the same `sequenceId` in both runs, 5,717,888 and then 5,718,941, which a quiet book also explains.
- Reply size: 1.5 to 9.0 KB per pair in 235 to 262 ms, and 1.5 to 9.4 KB in 176 to 337 ms in the rerun.

## 6. Rate limits and errors

No rate limit is documented, S1, and no reply carried a rate limit or `Retry-After` header, P1.
The probe never exceeded about five requests a second and saw no 403, 418 or 429.

| request | status | body |
|---|---|---|
| `/v1/public/book?pair=NOPEUSDC` | 400 | `{"status":false,"error":"Incorrect pair"}` |
| `/v1/public/ticker?pair=NOPEUSDC` | 400 | same |
| `/v1/public/trades?pair=NOPEUSDC` | 400 | same |
| `/v1/public/book` without `pair` | 400 | `{"name":"Bad Request","message":"Missing required parameters: pair","code":0,"status":400}` |
| `/v1/public/ticker` without `pair` | 400 | `{"name":"Bad Request","message":"Missing required parameters: pair","code":0,"status":400}` |
| `/v1/public/nope` | 404 | HTML, "Not Found (#404)" |

## 7. Server time and clock offset

`GET https://api.emirex.com/api/info/time`, the call the web app uses for its delay check, returns `{"status":true,"data":1790137956660,"is_login":false}` with the time in Unix ms, S2 and P1.
Five reads at 186 to 191 ms round trip put the server 5 to 9 ms ahead of the local clock, measured against the midpoint of each request, and five more in the rerun at 175 to 182 ms put it 0 to 3 ms ahead.

## 8. Recommended poller shape

No anchor poller is recommended, because Emirex publishes no index, mark or funding for any product.
A spot stage that wanted a catalog refresh could read `GET /v1/public/symbols` or `GET /api/default/ticker`, which return all 12 pairs in one call of 1.3 or 13.2 KB.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Emirex Exchange API, apidoc 0.22.0, generated 2022-04-14 | https://docs.emirex.com/ (data in `api_project.js` and `api_data.js`) | 2026-09-22 | Emirex | public calls, reply shapes, error example, sections 2, 3, 5 and 6 |
| S2 | Emirex web app bundles | https://emirex.com/trading/BTCUSDC and its `/_nuxt/` scripts, `BASE_API_URL` in `app/73475f63.c8898c7.js`, `/info/time` in `app/d0ae3f07.b1d7f43.js` | 2026-09-22 | Emirex | undocumented base, bulk ticker, config and time calls, sections 2, 3 and 7 |
| P1 | `rest-probe.mjs all` at 04:32 UTC, rerun at 04:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/emirex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | `rest-probe.mjs mirror` at 04:38 UTC, and again inside the 04:42 rerun of `all` at 04:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/emirex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | Emirex touch against Binance spot, section 4 |
