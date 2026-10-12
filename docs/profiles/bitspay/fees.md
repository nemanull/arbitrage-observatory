# Bitspay Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:15 to 03:40 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the trading fees of Bitspay, the exchange at `www.bitspay.io` that CoinMarketCap lists at rank 127.
Bitspay lists no perpetuals, so the researched product is its spot market, as change 1 of the survey plan's template says.
It has no CCXT class, see section 8.
Source ids are shared with [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | not named on any page read, the API docs footer gives "Tornimae St. 18, Tallinn, 10145, Estonia" | S1 |
| self description | `"location":"London"` in the public `info` call | P1 |
| registration | CoinMarketCap says Bitspay launched in January 2020, is based in Estonia, and "is regulated by Estonia under the Anti Money Laundering Counter-Terrorism Financing Act 2019" | P3 |
| who may trade | CoinMarketCap's description says "mandatory KYC", and the web bundle calls `getmykycstatus` and `updatemykycdetails` on `node.bitspay.io` | P3, S2 |
| regions | the terms in the web bundle say "Bitspay retains the right to choose its markets and jurisdictions to operate and may restrict or refuse its services to certain countries" | S2 |
| regions excluded | Not publicly specified, no country list was found in the terms text of the bundle | S2 |
| access from this host | every public call answered 200 through Cloudflare's Vancouver edge, with no refusal and no region message, see [`rest.md`](./rest.md) section 1 | P1, P2 |

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, every pair | 0.15 %, 1,500 ppm | 0.15 %, 1,500 ppm | P3 |

Three public calls carry the fee, and all three agree.
`assets/all` gives `maker_fee` 0.0015 and `taker_fee` 0.0015 on all 32 assets.
`ticker/all` gives `buyfee` and `sellfee` 0.0015 on all 54 pairs.
`getVendorInfo/` gives `vendors_buypricefee` and `vendors_salepricefee` 0.0015 on all 31 vendors.
The fee page at `https://www.bitspay.io/Fee_Rate` renders client side from `POST https://node.bitspay.io/getVendorinfo/`, the web twin of the last call, so it shows the same fields, S2.

CoinMarketCap's record shows `makerFee` 0 and `takerFee` 0, which disagrees with the venue's own calls, P3.
Its description also says "tiered trading fees", and no tier was found in any call or in the web bundle, see section 4.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| spot | yes, 65 pairs in the catalog, 54 with a ticker | P1, see [`rest.md`](./rest.md) section 2 |
| perpetuals, any margin | no | every `ticker/all` and `getCompleteMarkets/` row has `market_type` `SPOT`, P1, CoinMarketCap shows 0 perpetual pairs and 0 perpetual volume, P3, and the web app has no futures route, S2 |
| dated futures | no | CoinMarketCap shows 0 futures pairs, P3, and the web app has no futures route, S2 |
| options | no | no route, call or listing names one, S2 |
| margin or leverage on spot | no | no route, call or listing names one, S2 |

CoinGecko answers 404 `exchange not found` for `exchanges/bitspay` and 404 for `derivatives/exchanges/bitspay`, so it does not track the venue, P3.

## 4. Spot tiers

None published.
Every asset, pair and vendor row carries the same 0.0015 maker and taker, P3.
The web bundle has no VIP, tier or volume discount text, S2.

### Qualification

Not applicable, since there is one flat rate.

## 5. Discounts that change the taker

Not offered as far as public sources show.
No platform token discount, referral rebate or zero fee promotion appears in the API docs or the web bundle, S1, S2.
The bundle has a referral bonus route behind login, `applyforreferalbonus`, whose terms are not public, S2.

## 6. Funding as a cost

Not applicable, since Bitspay lists no perpetual.

## 7. Liquidation, settlement and delisting

Not applicable to spot.
Withdrawal fees are per asset in `getVendorInfo/` field `vendors_transferfee`, for example 0.0008 BTC, and are not detailed here, P3.

## 8. CCXT

| item | value | source |
|---|---|---|
| class in 4.5.68 | none, no `bitspay` file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` and no `bitspay` line among the 444 lines of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` | local search |
| class on GitHub | none, `ts/ccxt.ts` on the `master` branch, version 4.5.85 at commit `f0aca06` of 2026-10-08, has no `bitspay` line | S3 |
| `market.taker` | no value, since there is no class | |

## 9. Recommended registry values

Bitspay should not be registered.
The engine builds a venue from a catalog of perpetual contracts, as `markets.rs` does for Gate with `TAKER_PPM` at [`markets.rs`](../../../server/src/venues/gate/markets.rs) line 10, and Bitspay has none.

If a spot stage ever takes it, `takerPpm` is 1,500 from P3.
`ccxtTakerPpm` has no value to declare, because there is no CCXT class.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://api.bitspay.io/`, the public API documentation page, 18 numbered sections and the Tallinn footer | 2026-10-10 03:15 UTC |
| S2 | `https://www.bitspay.io/main.698422cc28dafc1d65ac.js`, the Angular web bundle, 1,905,051 bytes, searched for routes, endpoints, socket events, fee and terms text | 2026-10-10 03:16 UTC |
| S3 | `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts` and the GitHub commits API for `ccxt/ccxt` `master` | 2026-10-10 03:22 UTC |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/bitspay/rest-probe.py), first run 03:27 UTC, second run 03:29 UTC, second pass 03:32 UTC | 2026-10-10 |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/bitspay/ws-probe.py), first run 03:19 UTC, second run 03:22 UTC, second pass 03:33 UTC | 2026-10-10 |
| P3 | [`fees-probe.py`](../../../scripts/probes/venues/bitspay/fees-probe.py), first run 03:31 UTC, second pass 03:33 UTC, rerun at 03:39 UTC after the CoinMarketCap tags line was added | 2026-10-10 |
