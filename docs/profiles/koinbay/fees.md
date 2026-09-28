# Koinbay Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the fees of the Koinbay perpetual futures (no CCXT class) and names the other products in the coverage matrix.
The venue publishes no futures fee schedule.
Every futures fee below is read from the public contract catalog, captured by [`rest-probe.mjs`](../../../scripts/probes/venues/koinbay/rest-probe.mjs) mode `catalog`.

## 1. Scope and freshness

- The operator is KOINBAY LTD, named as the counterparty in the Terms and Conditions, "Last Updated on September, 2026" (S2).
  The Terms name no registration number or seat of incorporation.
  Disputes go to arbitration under the Dubai International Arbitration Centre rules, seated in the DIFC, Dubai (S2 clause 14.3).
- Schedule 1 Part A lists "Service-Restricted Jurisdictions": every EU and EEA member state, Iceland, Liechtenstein, Norway and the United Kingdom (S2 Schedule 1).
- Schedule 1 Part B lists "Prohibited Jurisdictions", which include the USA, American Samoa, Puerto Rico, the Northern Mariana Islands, the U.S. Virgin Islands and the United States Minor Outlying Islands, and also China, Russia, Iran, North Korea, Cuba, Syria and others (S2 Schedule 1).
- So US persons may not trade, and EU, EEA and UK residents are refused service.
  Canada is not named in either part.
- The Terms do not distinguish futures from spot, so the same restrictions apply to the perpetuals.
- Every public call from this host returned 200, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
  These access results are from the Canadian VPN exit, not from a US address.

## 2. Quick answer

The fee is set per contract in the catalog, with separate open and close fees that were equal on every active contract.

| family | contracts | maker | taker | source |
|---|---|---|---|---|
| USDT-M linear perpetuals, majors (BTC, ETH, SOL, XRP, BNB, DOGE and others) | 37 of 130 active, counting the 3 odd contracts of section 3 | 0.025 %, 250 ppm | 0.075 %, 750 ppm | `openMakerFee` and `openTakerFee` in `/fapi/v1/contracts`, probe `catalog` |
| USDT-M linear perpetuals, the rest | 93 of 130 active | 0.02 %, 200 ppm | 0.05 %, 500 ppm | same |
| BTC-margined inverse `E-BTC-USD` | 1 | 0.025 %, 250 ppm | 0.075 %, 750 ppm | same |

The probe grouped the 130 active contracts into exactly two fee groups: `open 0.00075/0.00025 close 0.00075/0.00025` on 37 and `open 0.0005/0.0002 close 0.0005/0.0002` on 93.
`E-BTC-USDT` and `E-ETH-USDT` are in the 750 ppm group.
The docs example for `E-BTC-USDT` shows the same `openTakerFee` 0.00075 and `openMakerFee` 0.00025 (S3).

The only published fee page gives a flat 0.3 % maker and 0.6 % taker "for buying and selling cryptocurrencies", which reads as the spot fee (S4).
It does not mention futures.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 127 active `E-*-USDT` plus 47 with `status` 0 | probe `catalog` |
| coin-margined inverse perpetual | yes, one: `E-BTC-USD`, margin BTC, `side` 0, `multiplier` 10 USD | probe `catalog` |
| `S-BTC-USDT` | listed active, margin coin `EXUSD` | probe `catalog`, looks like a demo or simulated contract, not researched |
| `FILCOIN-BTC-USDT` | listed active, margin coin `FILCOIN`, last trade in 2021, mark 60,377 against an index of 84,114 | probe `catalog`, `ticker_all` and a curl of `/fapi/v1/index` on 2026-09-22, see [`rest.md`](./rest.md) section 2, treated as a dead test contract |
| USDC-M perpetuals | absent | no `USDC` margin coin in the catalog |
| dated futures | absent | no contract name carries an expiry and every contract publishes a funding rate |
| options | absent | not in the docs index (S5) |
| spot | present, 234 symbols from `/sapi/v1/symbols` | probe by curl on 2026-09-22 |
| margin trading and leveraged tokens | named in the docs index | S5 |

CoinMarketCap's derivatives ranking lists 153 derivatives market pairs for Koinbay, while the catalog holds 130 active contracts.
CoinGecko returned 404 for `/api/v3/exchanges/koinbay` and lists no Koinbay entry in `/api/v3/derivatives/exchanges`.

## 4. Perpetual tiers

No futures tier table is published.
The fee page mentions "Possible introduction of maker-taker fees, volume-based tiering" as a future variation (S4).
The catalog fee is the only futures fee a public reader can see, and it carries no tier field.

## 5. Discounts that change the perpetual taker

None is published.
The fee page names "zero-fee promotions for KoinBay token trades" as a possible future variation, with no date (S4).
KBT is the venue token (S5), with no documented fee discount.

## 6. Funding as a cost

- The rate is published as `currentFundRate` and `nextFundRate` on `/fapi/v1/index` and on the `mark_price_<symbol>` socket channel, see [`rest.md`](./rest.md) section 4.
- The formula, the interval, the cap and the floor are not documented.
- The socket frame carried `nextSettlementTime` 1790236800000 on every probed symbol, which is 08:00 UTC, see [`websocket.md`](./websocket.md) section 6.
  An 8 hour interval is plausible but Not verified.
- Many contracts read exactly 0.0001 on both fields, the common default rate of 0.01 %.
- No public funding history endpoint exists: `/fapi/v1/fundingRate` answered `{"code":"-1002","msg":"UNAUTHORIZED"}`, the same body every unknown path gets.
- Who pays whom at settlement is not documented.
  The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

- Liquidation uses a liquidation price, an insurance fund and ADL (S6).
  No liquidation fee is published.
- Delisting notices for March and April 2026 exist in the docs index (S5).
  47 contracts sit in the catalog with `status` 0.

## 8. CCXT

CCXT 4.5.68 has no Koinbay class.
`require('ccxt').exchanges` from `server/` lists 104 ids and none matches `koin` or `bay`, probe `catalog` tag `ccxt`.
The GitHub contents listing of `ts/src` on the `master` branch of github.com/ccxt/ccxt, fetched 2026-09-22, holds 104 `.ts` files and none matches `koin` or `bay` (S7).
So `market.taker` cannot be read, and there is no source line to cite.
The CCXT check ran while `server/node_modules` held CCXT 4.5.68, and that folder was gone by the second pass, when `server/` had become the Rust crate.

## 9. Recommended registry values

- `takerPpm`: 750 for `E-BTC-USDT`, `E-ETH-USDT` and the other 36 contracts of the 750 ppm group, and 500 for the other 93.
  The registry holds one number per venue, so 750 is the safe single value, since it never understates a cross.
  A Koinbay adapter can read `openTakerFee` per contract from the catalog instead.
- `ccxtTakerPpm`: none, since no CCXT class exists.

## 10. Source ledger

- S1: [`rest-probe.mjs`](../../../scripts/probes/venues/koinbay/rest-probe.mjs), modes `catalog`, `anchor`, `book`, `errors`, run 2026-09-22.
- S2: Terms and Conditions, https://docs.koinbay.com/terms-and-policies/terms-and-conditions.md, Schedule 1 "Last updated: September 2026".
- S3: Futures REST API, https://docs.koinbay.com/api/futures-rest-api.md, section "Contracts".
- S4: Fees, https://docs.koinbay.com/services/fees.md.
- S5: Docs index, https://docs.koinbay.com/llms.txt.
- S6: Futures Trading, https://docs.koinbay.com/services/trading/futures-trading.md.
- S7: https://api.github.com/repos/ccxt/ccxt/contents/ts/src.
- Deposit and withdrawal schedules: the Fees page above, S4.
