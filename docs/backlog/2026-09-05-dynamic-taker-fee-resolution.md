# Dynamic taker fee resolution

Status: Not started.
Recorded: 2026-09-05.
Indexed in [BACKLOG.md](../BACKLOG.md).

Replace the single static taker rate per venue with fee resolution that identifies the rate per venue and per market.

## Finding

The engine models a taker fee as one number per venue.
`VenueRegistration.takerPpm` in `server/src/venues/registry.ts:11` holds one optional rate for a whole venue.
`VenueConnector.toMarket` in `server/src/ccxt/connector.ts:119` stamps that rate onto every market of that venue.
CCXT's own per market number is used only when the registry has no rate for the venue.

A real taker fee depends on the account tier, the product line, the symbol, and any active promotion.
[`profiles/binance/fees.md`](../profiles/binance/fees.md) states this in its opening scope.
Its authority order puts the authenticated account and symbol endpoint above every published table.
Binance keys its own commission endpoint by account and by symbol.

## Evidence

Probed against the live venues on 2026-09-05, on CCXT 4.5.68.

| Venue | Active swap markets | CCXT taker | Registry taker | Where the CCXT number comes from |
| --- | ---: | ---: | ---: | --- |
| binance | 778 | 500 ppm | none | Static literals at `ccxt/js/src/binance.js:1248` for linear and `:1283` for inverse. |
| bybit | 837 | 600 ppm | 550 ppm | Hardcoded fallback at `ccxt/js/src/bybit.js:2219`, reached because the public instruments-info response carries no `takerFee` field. |
| okx | 472 | 500 ppm | 500 ppm | Static table at `ccxt/js/src/okx.js:686`, merged onto the market at `:1852`. |

Every market on a venue reported the same rate as every other market on that venue.
No CCXT rate in this table was read from a live venue response.
All three trace to constants compiled into the library.

## Symptoms today

Binance has no registry rate, so it runs on a CCXT constant.
The disagreement warning at `server/src/ccxt/connector.ts:101` cannot fire for binance, because there is no second opinion to compare against.
Binance is the one venue whose fee is both unpinned and unwatched.

Bybit disagrees with CCXT by 50 ppm on all 837 of its markets.
The warning fires on every boot and reports a gap that is already known and already recorded.
A genuine rate change on bybit would arrive as a small edit to a warning that is always present.

OKX and CCXT agree at 500 ppm.
Two independently stale sources matching is not a confirmation.

## Why it matters

`netPpm` depends directly on `takerPpm`.
A stale rate skews every stored opportunity.
A rate that is too low is the dangerous direction, because the engine then surfaces opportunities that do not clear.

## What finishing this means

A fee resolves per market instead of per venue.
Where credentials exist, the rate comes from the venue's authenticated account and symbol endpoint.
The drift check separates a known offset from a new change, so silence means the rates are as expected.
`Market.takerPpm` in `server/src/engine/types.ts:16` already lives per market, so the storage layer needs no change.

## Known blockers

The authenticated endpoints need API credentials, and the startup catalog load has none.
Binance renders its USD-M and COIN-M tier tables in the web client, so no static VIP 0 row is fetchable from public HTML.
[`profiles/binance/fees.md`](../profiles/binance/fees.md) records both gaps and names `/fapi/v1/commissionRate` and `/dapi/v1/commissionRate` as the remediation.
