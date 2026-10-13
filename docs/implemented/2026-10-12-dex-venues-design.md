# DEX venues, design

Design of record for researching ten decentralised perpetual venues and building each one as a Rust adapter, with two agents per venue.
The research follows [`2026-09-22-venue-survey-design.md`](../plans/2026-09-22-venue-survey-design.md) and the build follows [`2026-10-08-venue-adapter-waves-design.md`](../plans/2026-10-08-venue-adapter-waves-design.md), so this doc records only what differs from them.
The plan that runs the work and holds the tracker is [`2026-10-12-dex-venues-plan.md`](./2026-10-12-dex-venues-plan.md).

**Status:** Done.

**Opened:** 2026-10-12.

## Source

On 2026-10-12 the main session loaded the markets of all 104 exchanges in CCXT 4.5.68 from this host, through the Canadian VPN exit, in 24 s.
53 of them loaded at least one active perpetual.
Matched against the CCXT column of [`../research/2026-09-22-venue-survey.md`](../research/2026-09-22-venue-survey.md) and the ten profiles older than the survey, 38 of the 53 were already researched.
The other 15 were never researched, because the survey's two sources were exchange rankings, and CoinGecko's ranks spot exchanges.

| CCXT id | Venue | Perpetuals | Kind |
|---|---|---|---|
| `aster` | Aster | 577 | DEX |
| `extended` | Extended | 328 | DEX |
| `lighter` | Lighter | 213 | DEX |
| `grvt` | GRVT | 194 | DEX |
| `apex` | ApeX | 88 | DEX |
| `pacifica` | Pacifica | 77 | DEX |
| `dydx` | dYdX | 73 | DEX |
| `paradex` | Paradex | 67 | DEX |
| `derive` | Derive | 15 | DEX |
| `hibachi` | Hibachi | 14 | DEX |
| `modetrade` | Mode Trade | 138 | DEX on Orderly |
| `woofipro` | WOOFi Pro | 138 | DEX on Orderly |
| `kucoineu` | KuCoin EU | 691 | regional twin of KuCoin |
| `okxus` | OKX US | 485 | regional twin of OKX |
| `myokx` | MyOKX (EEA) | 485 | regional twin of OKX |

Perpetuals are CCXT's count of active linear swaps quoted in USDT, USDC or USD.
CCXT marks all twelve DEX classes with `dex: true`.

- Mode Trade and WOOFi Pro read `api-evm.orderly.org`, the same Orderly network as the niza and nonkyc venues of the `orderly` module.
  CCXT's 138 rows are Orderly's 73 shared markets plus 65 markets of single builders, and the `orderly` loader keeps only the shared ones on purpose, as [`../profiles/niza/rest.md`](../profiles/niza/rest.md) records.
  So both would show Orderly's shared book again, and they are not scheduled.
- KuCoin EU, OKX US and MyOKX load as many perpetuals as KuCoin and OKX, so they are regional doors to venues the engine already reads, and they are not scheduled.
  Whether their books are separate was not checked.
- BitMEX has a CCXT class and no profile, but its announcement of 2026-09-22 reads "BitMEX Exchange Now Closed", and all 273 of its perpetuals are `Settled`.
- Alpaca needs an API key to list its markets, and CCXT declares no swap for it.

That leaves the ten DEXes, which this design researches and builds.

## Decisions

1. Each of the ten DEXes gets two agents in turn: a researcher, then a builder.
   This is the user's shape of 2026-10-12.
   There is no verifier per venue, so the main session's merge checks and gates stand in for it.
2. The researcher follows decisions 3 to 11 of the survey design and the template changes of [`2026-09-22-venue-survey-plan.md`](../plans/2026-09-22-venue-survey-plan.md).
   That means three profile files, Python probes run with `uv run`, the evidence labels, and the researcher's own second pass.
   Each researcher caps its work at about 40 minutes and keeps its temporary files under `.claude/survey-work/<id>/`, as the survey's last lanes did.
3. A DEX also answers the questions of [`2026-09-23-hyperliquid-research-plan.md`](../plans/2026-09-23-hyperliquid-research-plan.md), in a section "Decentralised layer" of `rest.md` placed before its source ledger.
   The section covers the chain or sequencer and how it stamps book and anchor times, and who may use the venue and from where.
   It names the oracle behind the index and the mark with its price sources.
   It says whether anyone can list a market, and so whether a ticker can name another token than the other venues list under it.
   It names any venue that routes to this one or that this one routes to.
4. The venue id and the profile folder are the CCXT 4.5.68 id, since all ten have a class, as decision 2 of the waves design says.
5. The builder follows decisions 3 to 26 of the waves design and the section "Rules for every unit" of [`2026-10-08-venue-adapter-waves-plan.md`](../plans/2026-10-08-venue-adapter-waves-plan.md), unchanged.
   Its gates are the four of decision 24, and the CCXT dump of the catalog gate applies to all ten.
6. A builder runs only when the researcher's verdict is "fits as is" or "fits with a named change".
   Any other verdict ends that venue with its research written down and no adapter.
7. A builder keeps only the venue's own listings.
   Markets that a third party deploys stay out, as Hyperliquid's builder dexes do.
8. Each venue is one lane, and the ten lanes run at once in one workflow.
   That is the user's limit of ten agents at a time, set on 2026-10-09, and a lane's builder starts as soon as its researcher returns.
9. Each builder works in its own copy of `server/` at `.claude/venue-work/dex/<id>/server`, and every build or test takes one of two lock slots, as decisions 28 and 29 of the waves design say.
   On 2026-10-12 the laptop had about 5 GB of memory available, with 24 of 48 GB of swap in use and a virtual machine holding 5.4 GB.
   A rebuild of the main tree after a one-file change peaked at 667 MB of compiler memory, so two slots fit.
10. A builder that needs a change outside its module and its registration lines stops and reports the exact change, as decision 30 of the waves design says.
    A new crate in `Cargo.toml` counts as such a change.
11. Where the live venue disagrees with the profile, the builder follows the venue and corrects the profile in place with the date it checked, as decision 26 of the waves design says.
12. The main session merges each passed unit into the main tree, runs `cargo test` and `live_catalog` there, writes each survey row and note from the researcher's summary, and updates the trackers and [`../README.md`](../README.md).
    No venue joins `ACTIVE_VENUES`, and nothing is committed, because the user commits.

## Rejected alternatives

- A verifier per venue, as the waves had.
  The user asked for two agents per venue.
  The builder's four gates, the main session's merge checks, and its `cargo test` and `live_catalog` runs on the merged tree replace it.
- A fourth file per venue for the decentralised layer, as Hyperliquid had in [`../research/`](../research/).
  Every other venue has three files, and one section per venue carries what the builder needs.
- Researching Mode Trade, WOOFi Pro and the three regional twins.
  They would add no book that the engine does not already read.
- Waves of five, as the survey began with.
  Ten lanes fit the user's limit of ten agents at a time, and a lane needs no other lane to finish.
- The JS probes of the first survey waves.
  New probes have been Python since 2026-10-09, as the survey plan records.

## Verification

- The main session runs the checks of the survey design's section "Verification" on every new profile: the prose rules, every relative link, and CCXT's taker for one perpetual of each venue against the profile's `ccxtTakerPpm`.
- Before merging a unit, the main session confirms that its copy changed only `src/venues/<id>.rs`, `src/venues/<id>/`, and its registration lines in `src/venues/mod.rs` and `src/venues/live_tests.rs`.
- After merging, `cargo test` passes in the main tree, and `live_catalog` lists the merged venues.

## What the live checks found

All ten venues fit, and all ten were built and merged on 2026-10-12, with 1,370 markets between them.
None needed a change outside its module, so the shared runtime carries ten decentralised venues as it stands.
The numbers per venue, the denials and the exceptions are in task 3 of the plan.

- Three venues give the engine less than their catalogs suggest.
  dYdX publishes no mark, so its rows carry mark 0 and the engine refuses every dYdX route at open.
  Paradex's API book leaves out the RPI orders that hold nearly all liquidity, so 56 of its 66 books were wider than 10 percent.
  281 of Extended's 328 perpetuals are RFQ markets with an indicative quote and another venue's index, so only its 47 order book markets are legs.
- CCXT 4.5.68 is wrong or stale on five of the ten.
  Its derive class reads a v2 host frozen since 2026-10-06, and its apex class swaps taker and maker and reads `minOrderSize` as the contract size.
  Its extended class keeps the RFQ markets, its grvt class keeps 10 delisted rows, and its paradex class types a spot market as a swap.
- Several indexes and marks lean on venues the engine already reads.
  GRVT's index is Binance's USD-M index about a second late, Aster's `OPENAIUSDT` and `ANTHROPICUSDT` indexes are Binance's markets of the same name, and Lighter's `DRV` index is Hyperliquid's price.
  Pacifica's crypto marks include the Binance, OKX, Bybit and Hyperliquid marks.
- The books held up.
  No smoke saw a market without a book, a crossed top or a stale book, and the three crosses that dYdX's Indexer sent in one 90 s run were repaired by its feed.
- Every venue's terms bar US persons, and seven of them bar Canada too, where this host's exit sits.
  Lighter's plain socket refuses that exit, while its documented read-only socket serves every market.
