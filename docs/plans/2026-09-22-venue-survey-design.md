# Venue survey research, design

Design of record for researching every venue on the CoinGecko exchange ranking that the engine has no profile for yet.
The work is documentation and read-only probe scripts.
It adds no runtime code and no registry entry.

**Status:** In progress.

**Opened:** 2026-09-22.

## Purpose

The engine runs five venues, and five more were researched and built on 2026-09-15.
Fifty venues is the stated target, and the Rust rewrite in [`../backlog/2026-09-17-rust-rewrite-requirements.md`](../backlog/2026-09-17-rust-rewrite-requirements.md) is the path to it.
Choosing which venues come next needs the same evidence for every candidate.
This survey collects it, one profile folder per venue, in the shape the 2026-09-15 package set.

## Source list

The user supplied the CoinGecko exchange ranking by trust score on 2026-09-22, ranks 1 to 164.
That page ranks spot exchanges, so a venue on it may or may not list perpetuals.
CoinGecko's derivatives list, read the same day through `https://api.coingecko.com/api/v3/derivatives/exchanges`, shows perpetuals for 44 of the 151 venues in the queue.
That count is a lower bound, since CoinGecko does not track every venue's derivatives.

Thirteen venues are removed because a profile already covers them:

| rank | venue | covered by |
|---|---|---|
| 1 | Coinbase Exchange | [`../profiles/coinbase/`](../profiles/coinbase/) |
| 2 | Binance | [`../profiles/binance/`](../profiles/binance/) |
| 3 | Kraken | [`../profiles/kraken/`](../profiles/kraken/) |
| 4 | OKX | [`../profiles/okx/`](../profiles/okx/) |
| 5 | Gate | [`../profiles/gate/`](../profiles/gate/) |
| 6 | Bitget | [`../profiles/bitget/`](../profiles/bitget/) |
| 7 | Bitstamp by Robinhood | [`../profiles/bitstamp/`](../profiles/bitstamp/) |
| 8 | MEXC | [`../profiles/mexc/`](../profiles/mexc/) |
| 11 | Binance US | [`../profiles/binance/websocket.md`](../profiles/binance/websocket.md) section Binance.US |
| 16 | Gemini | [`../profiles/gemini/`](../profiles/gemini/) |
| 24 | Bybit EU | [`../profiles/bybit/fees.md`](../profiles/bybit/fees.md) section Bybit EU |
| 26 | Bybit | [`../profiles/bybit/`](../profiles/bybit/) |
| 162 | Coinbase International Exchange | [`../profiles/coinbase/websocket.md`](../profiles/coinbase/websocket.md) section Coinbase International Exchange |

The remaining 151 venues are the queue in [`2026-09-22-venue-survey-plan.md`](./2026-09-22-venue-survey-plan.md).
Gate US stays in the queue, because the Gate profile does not cover it.

On 2026-09-23 the user added a second source, CoinMarketCap's exchange ranking, ranks 1 to 236.
It adds 98 venues that neither list above nor any profile covers, recorded in the plan's section "CoinMarketCap additions".
They follow the same template and decisions, and each waits for the user to schedule it.

## What the engine needs from a venue

The list is section "What the engine needs from a venue" of [`../implemented/2026-09-15-five-venue-research-design.md`](../implemented/2026-09-15-five-venue-research-design.md): catalog, fees, book feed and anchor.
Its file and line citations were true on 2026-09-15, and a researcher re-reads the cited code before relying on a line number.
The five adapters built after it, under [`../../server/src/venues/`](../../server/src/venues/), show what a recommended shape turns into.

## Deliverables

Each venue gets one profile folder under [`../profiles/`](../profiles/).

- `docs/profiles/<folder>/fees.md`, `docs/profiles/<folder>/websocket.md` and `docs/profiles/<folder>/rest.md`, following the template of [`../implemented/2026-09-15-five-venue-research-plan.md`](../implemented/2026-09-15-five-venue-research-plan.md) section "The profile template".
- `scripts/probes/venues/<folder>/*-probe.mjs`, the read-only scripts behind every probed number.
- One row per venue in [`../research/2026-09-22-venue-survey.md`](../research/2026-09-22-venue-survey.md), written by the main session from the researcher's structured summary.

The folder is the venue's CCXT 4.5.68 id when one exists, and a kebab-case slug of the venue's name otherwise.

## Evidence labels

The labels of the 2026-09-15 design apply unchanged: `Published`, `Dynamic`, `Account-gated`, `Negotiated`, `Region-specific`, `Not offered`, `Not publicly specified` and `Probed`.
A number with neither a source link nor a probe behind it is not written.
When the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## Decisions

1. The queue is the 151 venues left after the removals above, in the CoinGecko rank order the user gave.
   Rank order also sets priority, so a survey stopped early still holds the highest ranked venues.
2. One researcher per venue, five per wave, one workflow per wave.
   The next wave starts only after the main session has written the previous wave into the plan's tracker, the survey doc and the index.
   This is the user's rule, so that an exhausted limit still leaves finished waves behind.
3. The researched product is the venue's perpetuals when it lists any, with every perpetual family covered as in the 2026-09-15 design.
   A venue with no perpetuals is researched on its spot market: spot fees, the spot book channel, the spot catalog and its REST book.
   Dated futures, options and, on a perpetual venue, spot are named in the coverage matrix and not detailed.
4. Every venue gets the same three files.
   A surface the venue does not offer gets a short section that says so and shows how that was established.
   A venue that is defunct, unreachable or has no public API still gets its three files, each saying what was checked and what failed.
5. Probes are public, unauthenticated and read-only, stay well inside the venue's published limits, and hold sockets for about ten minutes per venue in total at most.
   A geoblock or a refusal is recorded with its status code and body as a fact about access from this host.
   No proxy, VPN or other route around a refusal is used.
6. CCXT is read at the installed 4.5.68, and each claim about it cites `server/node_modules/ccxt/js/src/<id>.js` with a line.
   A venue absent from 4.5.68 is checked against the current CCXT source on GitHub, and the result is written either way.
7. Each researcher runs its own second pass before it returns: every probe rerun once, every number against its probe output or source, every JSON block parsed, every relative link resolved, and the prose rules checked.
8. After each wave the main session checks every new file for the prose rules and for links that do not resolve, and compares each CCXT venue's reported taker with CCXT's own number for one market.
9. Researchers do not edit [`../README.md`](../README.md), the plan, this design, the survey doc, the code, or another venue's files, and they do not commit.
   The main session owns those files.
10. Probe scripts live under `scripts/probes/venues/<folder>/`, one folder per venue, instead of flat in [`../../scripts/probes/`](../../scripts/probes/).
    About three hundred new scripts would otherwise bury the twenty-three general probes there.
11. Each researcher returns a structured summary with the fields of the survey table, so the main session writes the survey row without reading the profiles.

## Rejected alternatives

### Every venue at once

It is the fastest wall clock.
It was rejected because the user asked for waves of five, and because a limit reached mid-run would leave 151 half-written folders instead of some finished ones.

### A verifier agent per venue

The 2026-09-15 package had a separate second pass and a main-session re-probe of the load-bearing claims.
A verifier per venue would double the agents in every wave.
It was rejected because the user asked for one agent per venue.
The researcher's own second pass and the main session's per-wave checks replace it, and a later adapter design re-probes the load-bearing claims of the venues it picks, as the 2026-09-15 design did.

### A one-line triage for spot-only venues

About two thirds of the queue lists no perpetuals, and the engine cannot use them as it stands.
It was rejected because the user asked for detailed research on every venue, and because a spot book feed is the same component a future spot leg would need.

### The flat probe folder

It matches the existing scripts.
It was rejected for the reason in decision 10.

## Verification

Per wave, the main session runs a prose check over every new doc: no em-dash, no arrow in prose, no semicolon joining two ideas, one sentence per line.
It resolves every relative link in the new docs.
It reads CCXT's taker for one swap market, or one spot market on a spot-only venue, of each CCXT venue in the wave, and compares it with the profile's `ccxtTakerPpm`.
A failed check is corrected in the profile before the wave is marked Done.
