# Gate US Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:15 to 03:29 UTC, and the second pass 03:31 to 03:37 UTC, from the development host near Seattle.

Gate US is the United States spot exchange of Gate, run by Gate US, Inc., with its own API host `api.gate.us`, its own socket host `ws.gate.us`, and its own order books.
It lists no perpetual, dated future or option, so this profile covers Gate US spot, as the survey plan's template change 1 asks, and names every other product in the coverage matrix.
The global Gate venue is a separate profile at [`../gate/`](../gate/), and it does not cover Gate US.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/gate-us/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| legal entity | Gate US, Inc., NMLS ID 2272810 | S1 |
| licences | money transmitter licences in the states and territories the licence page lists, 37 of them, and a Delaware check seller licence | S1 |
| who may trade | "a natural person who is at least eighteen (18) years old" who is "a resident of the United States or one of its territories" | S2, last updated 2026-08-07 |
| excluded regions | "Gate US does not currently operate in the following jurisdictions: Alaska, Texas, Louisiana, US Virgin Islands, New York, Washington, North Carolina" | S1 |
| sanctions | residents of US-embargoed regions and sanctioned or denied persons are refused | S2 |
| US persons | yes, Gate US exists to serve them, but not in the seven jurisdictions above | S1, S10 |
| institutions | an institutional services page exists at `https://www.gate.com/en-us/institution`, and its terms were not read | S10 |
| products named on the home page | spot, convert, staking, OTC and a card, and no futures | S10 |
| this host | Not established: the laptop's traffic leaves through a Surfshark VPN exit that geolocates to Canada, so its own state is unknown from the wire, and a resident of Washington, an excluded state, could not trade | S1 |

The website at `https://www.gate.com/en-us` and `https://us.gate.com/` refused this host.
`curl` got HTTP 403 with the 3-byte body `403`, and one headless Chrome load of `https://www.gate.com/en-us/fee` got an Akamai page titled "Access Denied", reference `18.f537cb17.1790134134.3bad9b63`, on 2026-09-23 at 03:28:54 UTC.
The public API and socket hosts answered this host normally, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
The website pages in the ledger were therefore read through a fetch that does not originate here.
`gate.us` answers 301 to `https://www.gate.com/en-us`, and `www.gate.us` answers 301 to `https://us.gate.com/`, probed with `curl` on 2026-09-23 at about 03:15 UTC.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | evidence |
|---|---|---|---|
| spot, schedule | Not verified | Not verified | the fee page names "Spot Trading Fee" and "VIP Levels and Fees", but its table is not in the served HTML, S3 |
| spot, catalog `fee` field | 0.2 %, 2,000 ppm, on 383 of 385 pairs | same | `GET /spot/currency_pairs`, P1 |
| spot, catalog `fee` field on `USDT_USD` and `USDC_USDT` | 0.1 %, 1,000 ppm | same | P1 |

The catalog field is not the fee schedule.
On global Gate the same field reads `"0.2"` on `BTC_USDT`, read on 2026-09-23 at about 03:29 UTC, while the published global VIP 0 spot fee is "0.100% / 0.100%" from 2026-04-09, S7.
So 2,000 ppm is what a CCXT class built like `gateeu` would report, section 8, and the Gate US VIP 0 rate itself is an open question.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---|---|
| USDT-margined perpetuals | no | 0 | `GET /futures/usdt/contracts` 404 with an openresty HTML page, twice, P1 |
| coin-margined perpetuals | no | 0 | `GET /futures/btc/contracts` 404, P1 |
| dated futures | no | 0 | `GET /delivery/usdt/contracts` 404, P1 |
| options | no | 0 | `GET /options/underlyings` 404, P1 |
| margin | no pairs | 0 | `GET /margin/currency_pairs` returns `[]`, and `GET /margin/uni/currency_pairs` returns 500 `SERVER_ERROR`, P1 |
| spot | yes, researched | 385 pairs, all `tradable`: 354 quoted in USDT and 31 in USD | P1 |

The API documentation covers spot only, S4.
CoinGecko's exchange page says "Derivatives: Yes, margin trading is available", S6, and the wire shows no margin pair, so that line is not supported by the API.
CoinGecko tracks 14 coins and 18 pairs and $187,726 of 24 h volume, S6, against the 385 pairs of the catalog.
Deposit, withdrawal, card, staking and OTC fees are looked up on the fee page, S3.

## 4. Spot tiers

| tier | qualification | maker | taker |
|---|---|---|---|
| VIP 0 to top tier | Not verified | Not verified | Not verified |

The fee page text says the VIP level is updated "once every 24 hours at a randomly selected time", S3.
The tier table, its volume thresholds and its asset thresholds render only in a browser session, and the browser session from this host was refused, section 1.
The VIP page at `https://www.gate.com/en-us/vip` shows the headings "VIP Criteria & Fee Structure" and "Trading Fee Rate" with no table in the served HTML, S3.

## 5. Discounts that change the spot taker

No discount was verified.
The fee page served no text about token holding, referral, market maker or zero fee promotions, S3.
The fee announcement category at `https://www.gate.com/en-us/announcements/fee` served "Not found yet", S3.
Whether Gate US honours a GT holding discount like global Gate is an open question.

## 6. Funding as a cost

Gate US lists no perpetual, so there is no funding, section 3.

## 7. Liquidation, settlement and delisting

There is no leverage, so there is no liquidation or settlement charge, section 3.
No delisting charge is published in the served pages.
Five pairs had an empty book on both sides while `tradable`: `ZEN_USDT`, `PVP_USDT`, `CP_USDT`, `RAVE_USDT` and `AEON_USDT`, in both passes, see [`rest.md`](./rest.md) section 5.

## 8. CCXT

CCXT 4.5.68 has no Gate US class.
`require('ccxt').exchanges` run from `server/` lists `gate` and `gateeu` and nothing named after Gate US, P1.
The current CCXT master at `https://github.com/ccxt/ccxt/tree/master/ts/src` holds `gate.ts` and `gateeu.ts` and no `gateus.ts`, and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/gateus.ts` answered 404, read on 2026-09-23 at about 03:15 UTC, S9.
So `market.taker` for a Gate US market does not exist in CCXT.

For context, `gateeu` is a 2,488-byte subclass of `gate` that swaps the API host and fetches spot only, at `server/node_modules/ccxt/js/src/gateeu.js` lines 13 to 58 of 60.
The probe built the same thing for Gate US by pointing `gateeu` at `https://api.gate.us/api/v4`, P1.
It loaded 385 spot markets, all active, with `market.id` equal to the wire id on 385 of 385, and `taker` 0.002 and `maker` 0.002 on `BTC/USD`.
The taker comes from the catalog `fee` percent divided by 100, and the maker falls back to it when `maker_fee_rate` is absent, at `server/node_modules/ccxt/js/src/gate.js` lines 1396, 1397, 1426 and 1427.
That is 2,000 ppm on 383 pairs and 1,000 ppm on `USDT_USD` and `USDC_USDT`, and section 2 explains why it is not the schedule.

## 9. Recommended registry values

None.
The engine's catalog keeps active swaps only, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202, and Gate US lists none.
If Gate US ever joins as a spot leg, `takerPpm` has to come from the fee page read in a browser session that the site serves, because the catalog field and a CCXT class built on it would report 2,000 ppm whatever the schedule says.

## 10. Source ledger

Ledger ids are shared by the three Gate US files, so an id missing here is used in another file.

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Gate US Licenses | https://www.gate.com/en-us/legal/licenses | 2026-09-22 | Gate US, Inc., US | entity, NMLS id, licences, excluded jurisdictions, section 1 |
| S2 | Gate US User Agreement, last updated 2026-08-07 | https://www.gate.com/en-us/legal/user-agreement | 2026-09-22 | Gate US, Inc., US | eligibility, sanctions, fee schedule reference, section 1 |
| S3 | Gate US Fees, VIP and fee announcements pages | https://www.gate.com/en-us/fee, https://www.gate.com/en-us/vip, https://www.gate.com/en-us/announcements/fee | 2026-09-22 | Gate US, Inc., US | headings only, the 24 h VIP update, no table in the served HTML, sections 2, 4 and 5 |
| S4 | Gate US API v4 documentation, v4.90.1 | https://us.gate.com/docs/developers/apiv4/ | 2026-09-22 | Gate US, Inc., US | spot only, section 3 |
| S6 | CoinGecko, Gate US exchange page | https://www.coingecko.com/en/exchanges/gate-us | 2026-09-22 | CoinGecko | 24 h volume, tracked coins and pairs, the margin line, section 3 |
| S7 | Gate Spot and Futures Fee Structure Upgrade, global Gate | https://www.gate.com/announcements/article/50390 | 2026-09-22 | Gate, global | global VIP 0 spot "0.100% / 0.100%" from 2026-04-09, section 2 |
| S8 | CCXT 4.5.68 `gate.js` and `gateeu.js` | `server/node_modules/ccxt/js/src/gate.js`, `server/node_modules/ccxt/js/src/gateeu.js` | 2026-09-22 | CCXT | fee parsing and the `gateeu` pattern, section 8 |
| S9 | CCXT master, `ts/src` listing | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Gate US class, section 8 |
| S10 | Gate US home and help pages | https://www.gate.com/en-us, https://www.gate.com/en-us/help | 2026-09-22 | Gate US, Inc., US | "State-licensed, US-based", products, institutional page, section 1 |
| P1 | `rest-probe.mjs catalog`, at 03:20 and 03:31 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/gate-us/rest-probe.mjs) | 2026-09-22 | this host | catalog, fee field, product paths, CCXT ids and mapping, sections 2, 3 and 8 |
