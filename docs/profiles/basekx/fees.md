# BASEKX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:41 to 07:10 UTC by the host clock, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the USDT-margined perpetuals of BASEKX (`www.basekx.com`), which has no CCXT class.
Every number carries a source from section 10, a probe reference, or both.
The probes are [`rest-probe.mjs`](../../../scripts/probes/venues/basekx/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/basekx/ws-probe.mjs).
Access results below are from that Canadian VPN exit, not from a US address.

## 1. Scope and freshness

- The platform's user agreement names the contracting entity as "Basekx PTE. LTD." and says the agreement "is governed by the laws of Singapore", S2.
- The agreement makes the user confirm "you will not access the services from restricted regions", S2, but it does not list the regions, and no list was found in the help center.
  Whether US persons may trade is therefore not stated publicly.
  Not verified.
- The help center names no license and no regulator, S2.
- The site publishes no API documentation.
  Its own configuration call `GET /pro/p/app/conf` returned `"open_api_document": null`, S3.
- The public REST and WebSocket endpoints answered this host without any refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 5.
- The fee article S1 was last updated 2026-09-19T16:13:04Z according to the help center API.

### The book is XT's book

The BASEKX futures API is the XT futures API shape under another host, with the same paths, field names and symbols.
At about 06:43 UTC one depth call on BASEKX and one on `fapi.xt.com/future/market/v1/public/q/depth?symbol=btc_usdt&level=5` returned the same update id `673312675677077587` and the same top two levels on each side, `84160.9 x 21269`, `84160.8 x 1357`, `84161.1 x 23654`, `84161.2 x 1079`.
Later calls to `fapi.xt.com` failed TLS from this host with "self-signed certificate in certificate chain" and `CERT_HAS_EXPIRED`, so the compare could not be repeated, see [`rest.md`](./rest.md) section 2.
`btc_usdt` also carries `onboardDate` 1651528801000, which is 2022-05-02, years before this brand's help center articles.
The reading is that BASEKX is a broker front end over XT's futures matching engine, so a BASEKX leg and an XT leg would be the same book.
That is an inference from one matching snapshot and the identical API, not a statement by either venue.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.04 %, 400 ppm | 0.04 %, 400 ppm | S1, and `makerFee` and `takerFee` `"0.0004"` on 162 of 163 symbols in `symbol/list` |
| `dot_usdt` only | 0.03 %, 300 ppm | 0.03 %, 300 ppm | `symbol/list`, `rest-probe.mjs catalog` |

S1 says "Maker (pending order) 0.04%, Taker (taking order) 0.04%" and "Fee = Position Value × Fee Rate".

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 161 active | `contractType` `PERPETUAL`, `underlyingType` `U_BASED`, `state` 0, `tradeSwitch` true, `rest-probe.mjs catalog` |
| event contracts | yes, 2 | `btcevent_usdt` and `ethevent_usdt`, `contractType` `EVENT` in the same list |
| coin-M perpetuals | no | `GET /futures/dapi/market/v1/public/symbol/list` returned `{"code":0,"msg":"success","data":[]}` |
| USDC-M perpetuals | no | no `usdc` quote in `symbol/list` |
| dated futures | no | no contract type other than `PERPETUAL` and `EVENT` |
| options | no | no product or route found in the web client |
| spot | yes, 22 pairs | `GET /pro/p/symbol/list` returned 22 rows, not researched further |

The perpetual list mixes crypto and share tokens such as `nvda_usdt` and `aaoi_usdt`, and the web client has a `/tradfi` section.

## 4. Perpetual tiers

No tier table is published.
S1 states one flat rate for everyone.
The web client calls a "step rate" table at `/futures/fapi/user/v1/user/step-rate/getStepRates` and `getUserStepRate`, which sit under the account API and were not called.
Not verified.

## 5. Discounts that change the perpetual taker

None published.
No token discount, referral discount or zero fee promotion was found in S1 or the help center.
Not verified beyond S1.

## 6. Funding as a cost

The perpetuals appear to charge no funding.

- `GET /futures/fapi/market/v1/public/q/funding-rate?symbol=<s>` returned `{"fundingRate":null,"collectionInterval":null,"nextCollectionTime":null}` on all 10 perps asked, including `btc_usdt`, `eth_usdt` and `nvda_usdt`, in `rest-probe.mjs anchor`.
- `GET .../q/funding-rate-record?symbol=<s>&limit=5` returned an empty `items` list on the same 10.
- The index price equals the mark price on every row, and the mark equals the last trade on 140 of 162 rows, see [`rest.md`](./rest.md) section 4.
- S1 does not mention funding.

No settlement instant was captured.
A perpetual with no funding has nothing that ties its price to spot except the book it mirrors.

## 7. Liquidation, settlement and delisting

- `liquidationFee` is `"0.015"`, 1.5 %, on `btc_usdt` in `symbol/list`.
- Nothing about settlement or delisting charges was found.
  Not verified.

## 8. CCXT

No class exists.
`require('ccxt').exchanges` in CCXT 4.5.68 from `server/` lists 104 ids, and none matches `base` or `kx` other than `coinbase*` and `*okx*`.
CCXT master on GitHub has no `ts/src/basekx.ts`: the `ts/src` listing on 2026-09-24 had no such file, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/basekx.ts` returned 404.
So `market.taker` cannot be read.
CCXT's `xt` class covers `fapi.xt.com`, which is a different host, see section 1.

## 9. Recommended registry values

None.
The venue has no CCXT catalog, no funding, and an index that is the perp's own price, so it should not be registered, see [`rest.md`](./rest.md) section 8.
If it ever were, `takerPpm` would be 400 from S1, and `ccxtTakerPpm` has no source.

## 10. Source ledger

| id | source | used for |
|---|---|---|
| S1 | https://support.basekx.com/hc/en-001/articles/53220536188441-Perpetual-Contract-Parameters-and-Rates, read through `https://support.basekx.com/api/v2/help_center/en-001/articles/53220536188441.json` | maker and taker, fee formula, contract table |
| S2 | https://support.basekx.com/hc/en-001/articles/53192389252889-User-Agreement-Terms-of-Use, same API, updated 2026-08-14 | entity, governing law, restricted regions clause |
| S3 | `GET https://www.basekx.com/pro/p/app/conf` | links to S1 and S2, `open_api_document` null |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/basekx/rest-probe.mjs) `catalog` and `anchor` | fees per symbol, families, funding nulls |
