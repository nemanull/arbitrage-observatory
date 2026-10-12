# CoinP Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 02:19 to 02:25 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocated to Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

CoinP could not be researched on any product, because no host of the venue answered.
Every CoinP host and path this host tried, the fee page among them, returned Cloudflare error 521, "Web server is down", see [`rest.md`](./rest.md) section 1.
CoinMarketCap describes perpetuals at 0.04 % maker and 0.06 % taker, S1, and this profile writes that claim down without being able to check it.
Every probed fact below comes from [`rest-probe.py`](../../../scripts/probes/venues/coinp/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/coinp/ws-probe.py).

## 1. Scope and freshness

- CoinMarketCap lists CoinP as exchange id 12030, slug `coinp`, with status `active` and launch date 2022-02-28, S1.
- CoinMarketCap's description says CoinP "was founded in Singapore in 2022" and is "based in Singapore", while the same record's `countries` field reads `["KR"]`, S1.
- The legal entity, the terms of service and the list of excluded regions could not be read, since the official site at `https://www.coinp.com/` returned 521 on every path, S2.
- Who may trade the perpetuals, and whether US or Canadian persons are excluded, is Not publicly specified as far as this host could read.
- The register link CoinMarketCap gives, `https://www.coinp1000.com/sign-up`, is on a second domain that also returned 521, S2.
- CoinGecko has no CoinP entry: `GET /api/v3/exchanges/coinp` returned 404 `{"error":"exchange not found"}` and the derivatives call returned 404 `{"error":"market not found"}`, S3.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| perpetuals, family not named | 0.04 %, 400 ppm, unverified | 0.06 %, 600 ppm, unverified | CoinMarketCap `makerFee` 0.04 and `takerFee` 0.06, and its description, S1 |
| spot | not stated as maker and taker | 0.1 %, 1,000 ppm, unverified | CoinMarketCap description, "a commission fee of 0.1% on spot trading", S1 |

None of these is from the venue.
The venue's own fee page, `https://www.coinp.com/en/fee`, which CoinMarketCap names as the fee source, returned 521, S2.
So the VIP 0 taker of the venue is recorded as unknown.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals | claimed, not verified | CoinMarketCap's description names "popular perpetuals like BTCUSDT, ETHUSDT, SOLUSDT, LINKUSD, XRPUSD", and its quote reports 2,272,234,195 USD of 24 h perpetual volume, S1. Its market pairs call lists 0 pairs, S1 |
| USDT-margined perpetuals | claimed by name only | BTCUSDT, ETHUSDT and SOLUSDT in the description, S1 |
| coin-margined or USD perpetuals | claimed by name only | LINKUSD and XRPUSD in the description, S1. Whether these are inverse contracts is unknown |
| dated futures | Not verified | CoinMarketCap reports 0 futures volume, S1 |
| options | Not verified | nothing names them |
| spot | claimed, not verified | 3,951,074,592 USD of 24 h spot volume on CoinMarketCap, with 0 spot pairs listed, S1 |
| margin | claimed, not verified | "up to 100X leverage via margin trading", S1 |

CoinMarketCap's volume figures sit beside an empty pair list, so they are not evidence that the books trade.

## 4. Perpetual tiers

No tier table could be read.
CoinMarketCap gives one maker and one taker number and no tiers, S1.

## 5. Discounts that change the perpetual taker

None could be read.
No token, referral, market maker or zero fee program was found in any source this host could reach.
The CoinMarketCap register link carries a referral id, `r_user_id=WZFV960KP`, S1, which shows a referral program exists but not its terms.

## 6. Funding as a cost

Not publicly specified as far as this host could read.
No funding formula, interval, cap or charging rule appears in CoinMarketCap's record, and no venue page answered.

## 7. Liquidation, settlement and delisting charges

Not publicly specified as far as this host could read.

## 8. CCXT

CCXT 4.5.68 has no CoinP class.
The installed `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` imports `coinone` and then `coinsph` at lines 87 and 88, and its `exchanges` map holds `'coinone'` and `'coinsph'` at lines 276 and 277, with no `coinp` between them, S4.
The folder `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds no `coinp.js`, S4.
The current CCXT source on GitHub has no CoinP class either: `ts/src` at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` has 110 entries and none starts with `coinp`, S5.
So there is no `market.taker` to report.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | none | the venue's own fee page could not be read, and CoinMarketCap's 600 ppm is a third-party claim. Write 600 only if a later run reads it from the venue |
| `ccxtTakerPpm` | none | no CCXT class exists |

The venue should not be added to the registry, because no catalog, book or anchor could be read, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | CoinMarketCap exchange page `https://coinmarketcap.com/exchanges/coinp/` and `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinp&category=<spot, perpetual, futures>`, read by [`rest-probe.py`](../../../scripts/probes/venues/coinp/rest-probe.py) | 2026-10-10 UTC | listing, fees, volumes, description, empty pair lists |
| S2 | `https://www.coinp.com/`, `/en/fee`, `https://www.coinp1000.com/` and the other hosts in [`rest.md`](./rest.md) section 1, read by [`rest-probe.py`](../../../scripts/probes/venues/coinp/rest-probe.py) | 2026-10-10 UTC | the 521 on every path |
| S3 | `https://api.coingecko.com/api/v3/exchanges/coinp` and `/api/v3/derivatives/exchanges/coinp` | 2026-10-10 UTC | no CoinGecko entry |
| S4 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` and `js/src/`, CCXT 4.5.68 | 2026-10-09 | no class |
| S5 | `https://api.github.com/repos/ccxt/ccxt/git/trees/master`, then `ts` and `ts/src`, read by [`rest-probe.py`](../../../scripts/probes/venues/coinp/rest-probe.py) | 2026-10-10 UTC | no class on master |
