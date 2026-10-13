# DEX venues, plan

Implements [`2026-10-12-dex-venues-design.md`](./2026-10-12-dex-venues-design.md), which is the design of record.
Decision numbers below are that doc's unless they name another.

**Status:** Done.

## Scope guard

This work does not:

- add an id to `ACTIVE_VENUES` or start any venue,
- change the engine, the feed and poller runtimes, the shared venue helpers, `Cargo.toml`, the database schema, the migrations or CI,
- change an existing adapter or another venue's profile,
- research or build Mode Trade, WOOFi Pro, KuCoin EU, OKX US, MyOKX, or any market that a third party deploys,
- create a wallet, sign anything, call a private endpoint, or place an order,
- probe faster than a venue's published limit, or route around a refusal,
- add a JS file to the repository,
- commit anything, because the user commits.

## Tracker

Lanes go by perpetual count, and odd lanes build under lock slot 0 and even lanes under slot 1.
Perpetuals is CCXT's count from the coverage check, and Markets is the adapter's catalog on 2026-10-12.

| Lane | Venue | Id and folder | Perpetuals | Verdict | Markets | Research | Build |
|---|---|---|---|---|---|---|---|
| 1 | Aster | `aster` | 577 | fits with a named change | 573 | Done | Done |
| 2 | Extended | `extended` | 328 | fits with a named change | 47 | Done | Done |
| 3 | Lighter | `lighter` | 213 | fits with a named change | 194 | Done | Done |
| 4 | GRVT | `grvt` | 194 | fits with a named change | 184 | Done | Done |
| 5 | ApeX | `apex` | 88 | fits with a named change | 126 | Done | Done |
| 6 | Pacifica | `pacifica` | 77 | fits with a named change | 77 | Done | Done |
| 7 | dYdX | `dydx` | 73 | fits with a named change | 73 | Done | Done |
| 8 | Paradex | `paradex` | 67 | fits with a named change | 66 | Done | Done |
| 9 | Derive | `derive` | 15 | fits with a named change | 15 | Done | Done |
| 10 | Hibachi | `hibachi` | 14 | fits as is | 15 | Done | Done |

## How the lanes run

1. The main session restores `node_modules` with `pnpm install --frozen-lockfile`, so CCXT 4.5.68's sources sit at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`.
2. It copies `server/` without `target/` to `.claude/venue-work/dex/<id>/server` for each venue, and once more to `.claude/venue-work/dex/base/server`, the untouched base that the merge compares against.
   It creates the lock files `.claude/venue-work/build-0.lock` and `.claude/venue-work/build-1.lock`.
3. It runs one workflow with ten lanes.
   Each lane runs its researcher, then its builder when design decision 6 allows.
4. When the lanes return, it checks each profile as the design's section "Verification" says, and writes the venue's row and note into [`../research/2026-09-22-venue-survey.md`](../research/2026-09-22-venue-survey.md) under wave `D`.
5. It merges each unit whose builder passed, as the section "Merge" below says.
6. It sets the tracker above, records each venue's live check numbers, denials and exceptions under task 3 below, and adds one line per new profile file to [`../README.md`](../README.md).

## Researcher rules

The researcher follows design decisions 2 to 4.

- It reads the design, the survey design's sections "What the engine needs from a venue", "Evidence labels" and "Decisions", the survey plan's sections "The profile template", "Changes after wave 1", "Network path" and "Waves 39 to 54, in lanes", and the section "The profile template" of [`2026-09-15-five-venue-research-plan.md`](./2026-09-15-five-venue-research-plan.md).
- It skims [`../profiles/hyperliquid/rest.md`](../profiles/hyperliquid/rest.md) and [`../profiles/hyperliquid/websocket.md`](../profiles/hyperliquid/websocket.md) as the worked example of a DEX.
- It reads decisions 3 to 6 and 18 to 22 of the waves design, so the recommended feed and poller shapes answer what the builder must decide.
- It writes only `docs/profiles/<id>/fees.md`, `docs/profiles/<id>/websocket.md`, `docs/profiles/<id>/rest.md` and `scripts/probes/venues/<id>/<topic>-probe.py`.
- It returns a structured summary with the survey table's fields, the venue's note in the shape of that doc's "Notes per venue", and a short brief for the builder.

## Builder rules

The builder follows design decisions 5 to 11 and the waves plan's section "Rules for every unit", with these substitutions.

- Its copy is `.claude/venue-work/dex/<id>/server`, and its lock is `.claude/venue-work/build-<slot>.lock`.
- The researcher's summary stands in for the scouts' cards.
- The CCXT dump of the catalog gate is a throwaway script under `.claude/venue-work/dex/<id>/`, never inside `server/`.
- The closest existing adapters for a DEX are [`hyperliquid.rs`](../../server/src/venues/hyperliquid.rs), which posts JSON to an info endpoint, and [`orderly.rs`](../../server/src/venues/orderly.rs).

It returns a report with its status, the summary lines of the four gates, the live smoke numbers, its denials, accepted exceptions and CCXT differences, each profile correction, and any shared change it needs.

## Merge

For each unit whose builder passed, the main session:

1. Lists the files the copy changed against `.claude/venue-work/dex/base/server`, and refuses the unit if any file outside `src/venues/<id>.rs`, `src/venues/<id>/`, `src/venues/mod.rs` and `src/venues/live_tests.rs` changed.
2. Copies `src/venues/<id>.rs` and `src/venues/<id>/` into the main tree's `server/src/venues/`.
3. Adds the unit's registration lines to the main tree's `server/src/venues/mod.rs` and `server/src/venues/live_tests.rs` by hand, since every unit adds lines in the same places.
4. From `server/`, runs `flock ../.claude/venue-work/build-0.lock cargo test`, then `cargo test live_catalog -- --ignored --nocapture` with every merged id in `LIVE_VENUES`.

A refused, blocked or failed unit keeps its copy and its status, and the main session decides whether a shared change or a rerun clears it.

## Tasks

### 1. Prepare

Steps 1 and 2 of "How the lanes run".

### 2. Lanes

The workflow of step 3.

### 3. Write down and merge

Steps 4 to 6 of "How the lanes run", and the section "Merge", once the lanes returned.

#### Results

The workflow ran its 20 agents from about 22:12 to 23:28 UTC on 2026-10-12, and every researcher and builder returned.
Nine researchers found "fits with a named change" and Hibachi's found "fits as is", so all ten builders ran, and all ten passed their four gates.
No builder needed a shared change.
Each copy changed only `src/venues/<id>.rs`, `src/venues/<id>/` and its registration lines in `mod.rs` and `live_tests.rs`, so all ten merged.
The registration lines sit after `koinbay` in `load_venue`, `start_venue` and `ALL_VENUES`, in lane order.

On the merged tree at about 23:32 UTC, `cargo test` gave 2,422 passed, 0 failed and 61 ignored.
That is the 2,054 tests of the base plus 368 venue tests, and the ignored count grew by the eight live capture probes.
The build showed only the two warnings the base already had, in `test_log.rs` and `engine/opportunity.rs`.
`live_catalog` with all ten ids at 23:33 UTC listed 1,370 markets, the same count per venue as each builder's gate.
CCXT 4.5.68's taker for one perpetual of each venue matched the profile's `ccxtTakerPpm` on all ten.
The prose and link check found nothing in the 30 profile files.

| Venue | Markets | CCXT dump | Smoke updates in 90 s | Never anchored | Identity, 30 s unless named |
|---|---|---|---|---|---|
| aster | 573 | 577 | 310,788 | 2 | 556 compared, 553 within 2 percent, 3 from 2 to 10 percent |
| extended | 47 | 328 | 23,906 | 15 | 38 compared, all within 2 percent |
| lighter | 194 | 213 | 43,642 | 15 | 171 compared, 98 by own anchor, all within 2 percent |
| grvt | 184 | 194 | 30,221 | 0 | 183 compared in 90 s, all within 2 percent |
| apex | 126 | 88 | 13,486 | 0 | 125 compared, all within 2 percent |
| pacifica | 77 | 77 | 27,643 | 0 | 75 compared, 74 within 2 percent, 1 from 2 to 10 percent |
| dydx | 73 | 73 | 103,310 | 0 | 72 compared, 1 by own anchor, 71 within 2 percent, 1 from 2 to 10 percent |
| paradex | 66 | 67 | 2,794 | 0 | 66 compared, 56 by own anchor, 65 within 2 percent, 1 from 2 to 10 percent |
| derive | 15 | 15 | 6,981 | 0 | 15 compared, all within 2 percent |
| hibachi | 15 | 15 | 1,639 | 0 | 14 compared, all within 2 percent |

Every smoke had 0 markets without a book, 0 never two sided, 0 crossed tops and 0 stale books.
No identity run had a market more than 10 percent away once the denials were in.
Every builder corrected or extended its profile in place, dated 2026-10-12, as decision 11 says.

- aster denies `AIUSDT`, `MEMEUSDT`, `ONUSDT` and `RTXUSDT`, which name other tokens than the references list, and its first identity run failed on exactly these four.
  `OPENAIUSDT` and `ANTHROPICUSDT` get books and no anchor rows, because each index is Binance's market of the same name.
  Its taker is set per market, 400 ppm on General, 1,000 ppm on 18 Group B markets and 125 ppm on 120 RWA markets, where CCXT puts 350 ppm on every market.
  A book still empty 5 s after its connection's first frame is read once from REST, which was 23 of 573 books in one run.
- extended keeps the 47 order book markets and drops the 281 RFQ markets that CCXT keeps, because an RFQ book is an indicative quote and its index and mark are Binance's or Hyperliquid's.
  Its 15 RWA order book markets get no anchor rows, because their mark equals their index most of the time and their index comes from Extended's own book while the oracle is closed.
  Each market's opening replay is held until a frame of another market arrives, and the profile's first rule, which would have published replayed frames as fresh, was corrected.
- lighter reads the documented read-only socket, because the plain URL refuses this host's Canadian exit with code 20558.
  It drops the 16 `force_reduce_only` markets, denies `BB`, `AI` and `PRL`, and keeps `WEN`, which the researcher had marked for denial, because binance, okx and gate list the same stock.
  The three Pre-IPO markets, and the markets whose index runs on Lighter's internal price, get no anchor rows, which was 15 markets in the smoke.
  It reads that list once a minute, and its books fill over about 78 s after a connect, because the venue allows 200 client messages a minute per IP.
- grvt drops the 10 `DELISTED` rows that CCXT keeps, and `KBONK`, `KPEPE` and `KSHIB` cluster as BONK, PEPE and SHIB at `price_scale` 0.001.
  Its anchors come from the socket's `v1.ticker.s`, and its paced subscribes leave anchor rounds warming up for about 83 s after a start.
  The smoke held 368 streams on four sockets with no refusal, which answers the profile's question about a cap of 150 per address.
- apex keys markets by CCXT's `id2`, keeps 40 TradFi rows that CCXT does not load, under waves decision 4, and leaves out `IO-USDT` and `STBL-USDT`, which the venue hides and which sent no book.
  Its contract size is 1 where CCXT copies `minOrderSize`, and its taker is 500 ppm where CCXT swaps taker and maker.
- pacifica's `kPEPE`, `kBONK` and `kSHIB` cluster as PEPE, BONK and SHIB at `price_scale` 0.001, and every book frame is the whole book of 10 levels, so the feed replaces the book each time.
  `BP` sat 2.7 to 3.1 percent from MEXC on its own book 2.8 percent wide, and both read as Backpack's token.
- dydx sends mark 0 under waves decision 19, because dYdX marks positions at its oracle price, so the engine refuses every dYdX route at open as a markless leg.
  Its feed drops the older of two crossing levels, as the dYdX docs ask, which happened 3 times in the first 90 s smoke.
  The Indexer's 429 sends `Retry-After` in milliseconds, so the module turns the pause back into milliseconds itself.
- paradex decodes the venue's SBE binary frames with a small decoder in `paradex/sbe.rs`, and it puts 30 markets on each socket, because the server serves 10 subscribe requests a second per socket after a burst of 20.
  Its API book leaves out RPI orders, so 56 of 66 books were wider than 10 percent and were compared by their mark, an exception accepted as WOO X's was.
  It drops `DIME-USD`, a spot market that CCXT types as a swap.
- derive reads the v3 API at `api.derive.xyz/v3`, because CCXT 4.5.68 reads the v2 host that has served frozen prices since 2026-10-06.
  So only the quote differs from the CCXT dump, USDC against USD, which the quote family folds together.
- hibachi matches CCXT row for row, checks each frame's level window since its book has no sequence, and repairs a failed market with an unsubscribe and a subscribe on the same socket.
  A crossed top publishes an empty book until a frame uncrosses it, and the anchor sends rows only for markets that are `LIVE` with `symbolStatus` `OPEN`.

The main session kept the anchor rows of Paradex's 23 RWA perpetuals, which the builder left to it.
In closing hours an EMA of Paradex's own mark weighs 10.6 to 13.5 percent of their index, a minority input.
Backpack and WhiteBIT left their TradFi rows out because those indexes became the venue's own book or its last trade.

Open before any of these venues is activated:

- dYdX routes need an engine rule for a venue that marks positions at its oracle, or they never open.
- Most Paradex books are usable only with RPI orders, which the API book leaves out, or through the Retail route and its 300 ms speed bump.
- Extended moves settlement from Starknet to Circle's Arc on 2026-10-22 at 12:00 UTC, and its API host `api.starknet.extended.exchange` may change then.
- Lighter's `DRV` index is Hyperliquid's price, and nothing refuses a `DRV` route between the two.
- GRVT's equity marks during closed sessions are an EWMA of its own last price inside bands of 3 to 8 percent, the capped mark shape the reader takes as fresh.
- Pacifica's crypto marks include the Binance, OKX, Bybit and Hyperliquid marks, so a cross against those venues is judged partly by the other leg's own price.
- Every venue's terms bar US persons, and the terms of Aster, Extended, Lighter, GRVT, dYdX, Paradex and Derive bar Canada too, where this host's exit sits.

### 4. Reconcile

- Audit the design and this plan against what shipped, edit every claim that changed, and set every status.
- Move both docs to [`implemented/`](./) and update [`../README.md`](../README.md).

Done on 2026-10-12.
