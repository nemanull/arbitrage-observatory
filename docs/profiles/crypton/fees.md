# Crypton Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09, for the venue survey of 2026-09-22, CoinMarketCap addition at rank 151, wave 45.

**Probed:** 2026-10-10 between 03:27 and 03:46 UTC, the evening of 2026-10-09 in local time, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the spot market of Crypton Exchange, the Utopia ecosystem exchange at `crp.is`.
Crypton Exchange lists no perpetuals, see section 3, so change 1 of the survey plan's template applies and every section below is about spot.
CCXT 4.5.68 has no Crypton class, see section 8.
Every probed value comes from [`fees-probe.py`](../../../scripts/probes/venues/crypton/fees-probe.py) unless a row names another probe.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | Crypton Exchange, launched inside the Utopia P2P network in January 2021 and also served on the clear web at `https://crp.is` | S3, S4 |
| operator | not named. The terms of use in the web bundle only say "the Company" | S2 |
| excluded regions | the terms require that the user is "not citizens or permanent / temporary residents of the United States of America" | S2 |
| Canada | not excluded by the terms | S2 |
| who may trade spot | a registered user, signed in with a Utopia public key and a password, with no KYC check | S1 `/user/login`, S3 |
| access from this host | every public page and API call answered from the Canadian exit, with no geoblock, see [`rest.md`](./rest.md) section 1 | [`rest-probe.py`](../../../scripts/probes/venues/crypton/rest-probe.py) |

## 2. Quick answer

| product | maker | taker | label | source |
|---|---|---|---|---|
| spot, every pair | unknown | unknown | Account-gated | S2 |

The trading fee is not published anywhere a signed-out visitor can read it.
The `/fees` page renders "Trading fee {{percent}}", and the percent comes from `config.commission` in the reply to `/user/login`.
Signed out, the web client holds the default `config:{commission:0}`, so the page shows 0 %, which is a placeholder and not a fee.
The API reference, S1, names no trading fee and has no percent sign in it.
The launch thread, S3, names no trading fee percent.
CoinMarketCap lists `makerFee` 0 and `takerFee` 0 for the venue, S4, which reads as unset rather than as a zero fee schedule.

A 2021 launch press release, S7, is quoted by third-party listings as charging 0.1 % per trade.
Both copies answered HTTP 403 to this host, so the figure was not read at its source and is not used below.

## 3. Coverage matrix

| product | present | how established |
|---|---|---|
| USDT-M perpetuals | no | S1 documents only the `market`, `orders`, `history`, `user` and `billing` groups, and the web bundle S2 routes only spot pages |
| coin-M perpetuals | no | as above |
| dated futures | no | as above. `GET /futures/pairs` and `GET /contract/pairs` answer `404 page not found`, [`rest-probe.py`](../../../scripts/probes/venues/crypton/rest-probe.py) |
| options | no | as above |
| spot | yes, 3 pairs | `GET /market/pairs`, see [`rest.md`](./rest.md) section 2 |
| perpetual volume on listings | 0 | CoinMarketCap `perpetualVolume24h` 0 and `futuresVolume24h` 0, S4. CoinGecko's derivatives list of 216 venues has no Crypton, Crp or Utopia entry, S5 |

## 4. Spot tiers

No tier table is published.
The bundle S2 carries no VIP, volume or level wording near the fee display, and the fee is a single `commission` number per account.

## 5. Discounts that change the spot taker

None published.
The bundle S2 and the API reference S1 mention no token discount, referral rebate, market maker program or zero fee promotion.

## 6. Funding as a cost

Not offered.
Crypton Exchange lists no perpetuals, so there is no funding.

## 7. Liquidation, settlement and delisting charges

Not offered for trading, since there is no margin or derivative product.
The venue's own deposit and withdrawal fees are public in `GET https://crp.is:8182/market/curlist`.

| currency | deposit fee | deposit minimum | withdrawal fee | `withdraw_fee_pro` | withdrawal minimum | enabled |
|---|---|---|---|---|---|---|
| BTC | 0 | 0.0001 | 0.0001 | 0 | 0.0005 | yes |
| CRP | 0 | 0.01 | 0 | 0.1 | 5 | yes |
| DAI (ERC-20) | 10 | 30 | 10 | 0 | 15 | no |
| USDT (TRC-20) | 1 | 2 | 1 | 0 | 5 | yes |
| UUSD | 0 | 0.01 | 0 | 0 | 1 | yes |
| XMR | 0.001 | 0.025 | 0.001 | 0 | 0.01 | yes |

The web client labels `withdraw_fee` "Fixed fee" and `withdraw_fee_pro` "Fee", S2, which suggests a fixed amount plus a percentage.
BTC and XMR are listed as currencies but no pair trades them, see [`rest.md`](./rest.md) section 2.
The billing history call records fees as `comission` entries, S1 `/history`.

## 8. CCXT

CCXT 4.5.68 has no Crypton class.
There is no file whose name contains "crypton", "crp" or "utopia" under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`.
No key in the `exchanges` map that starts at line 232 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` names it.
A search of every class for `crp.is` or "crypton" finds only a comment linking a "cryptonomist" article, at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/htx.js` line 1169 and `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/bittrade.js` line 418.
The current CCXT source on GitHub, master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, has 103 TypeScript files under `ts/src/` and none of them is a Crypton class, S6.
`market.taker` is therefore not available for any Crypton pair.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | none | the fee is Account-gated, section 2 |
| `ccxtTakerPpm` | none | no CCXT class, section 8 |

These values only matter if the engine gains a spot leg.
As a perpetual venue Crypton Exchange has nothing to register.

## 10. Source ledger

| id | source | used for |
|---|---|---|
| S1 | API reference, `https://crp.is/api-doc/`, served with `Last-Modified: Mon, 13 Jul 2026 21:20:15 GMT`, read 2026-10-09 | endpoint groups, login, billing history, no fee wording |
| S2 | web bundle `https://crp.is/static/js/main.98f09429.chunk.js`, read 2026-10-09 | fee display and its `config.commission` source, terms of use, field labels |
| S3 | launch thread `https://talk.u.is/viewtopic.php?pid=212`, first post of 2021-01-09, linked by CoinMarketCap as the venue's chat | launch, no KYC, original pairs |
| S4 | CoinMarketCap venue page `https://coinmarketcap.com/exchanges/crypton-exchange/`, read 2026-10-09 | website, fee link, listed fees and volumes |
| S5 | CoinGecko `https://api.coingecko.com/api/v3/derivatives/exchanges/list`, read 2026-10-09 | no derivatives listing |
| S6 | CCXT 4.5.68 at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/`, and CCXT master on GitHub at commit `f0aca06` | section 8 |
| S7 | launch press release, `https://ambcrypto.com/crypton-exchange-trade-crp-with-no-kyc-or-limits-on-utopia-p2p/` and its copy on `blockonomi.com`, both HTTP 403 from this host | the unread 0.1 % claim |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/crypton/fees-probe.py) | sections 2, 3 and 7 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/crypton/rest-probe.py) | sections 1 and 3 |
