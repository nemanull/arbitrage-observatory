# Exchange Profiles Research Implementation Plan

**Goal:** Produce complete, sourced, and readable fee and WebSocket profiles for Binance, Bybit, OKX, Coinbase, and Kraken.

**Architecture:** Detailed facts live in consistent per-exchange profiles.
Two concise research documents normalize the verified facts for cross-exchange decisions.
Every time-sensitive claim links directly to an official source and records its retrieval date and applicability.

**Tech Stack:** Markdown, official exchange documentation, official REST and WebSocket API references, JSON, and repository prose rules.

**Design of record:** [`2026-07-26-exchange-profiles-design.md`](../implemented/2026-07-26-exchange-profiles-design.md).

---

**Status:** Done.

**Archived:** 2026-07-26.

## Scope guard

This work does not implement exchange clients.
It does not open exchange accounts or bypass regional access controls.
It does not call authenticated endpoints with user credentials.
It does not claim that dynamic, negotiated, or account-gated fees have one universal static value.
It does not use third-party summaries as evidence for fee rates or protocol behavior.
It does not design order routing, execution logic, portfolio logic, or risk controls beyond identifying their data requirements.

## Task 1: Establish source and document controls

**Files:**

- Modify: `docs/README.md`
- Create: `docs/research/2026-07-26-exchange-fees-comparison.md`
- Create: `docs/research/2026-07-26-exchange-websocket-comparison.md`

**Step 1: Create source ledgers**

Create one official-source ledger in each research document.
Use columns for exchange, source title, direct URL, retrieval date, region or entity, subject, and verification status.

**Step 2: Create coverage matrices**

Create a fee matrix for all known market and service families.
Create a WebSocket matrix for all public and private data classes relevant to detection, validation, and execution.

**Step 3: Define evidence labels**

Use `Published`, `Dynamic`, `Account-gated`, `Negotiated`, `Region-specific`, `Not offered`, and `Not publicly specified`.
Never interpret an absent number as zero.

**Step 4: Index the research documents**

Add one line for each new document under the Research section in `docs/README.md`.

**Step 5: Verify structure**

Run:

```bash
rg -n '^#|^##|^\\| Exchange' docs/research docs/README.md
```

Expected result:
Both research files have titles, coverage sections, source ledgers, and index entries.

## Task 2: Research and write the Binance profiles

**Files:**

- Modify: `docs/profiles/binance/fees.md`
- Create: `docs/profiles/binance/websocket.md`
- Modify: `docs/README.md`

**Step 1: Inventory official Binance entities and products**

Locate the current official fee schedules for global Binance products and separately documented regional entities.
Record spot, margin, convert, USD-margined futures, coin-margined futures, options, loans, custody, staking, cards, deposits, withdrawals, and service programs where offered.

**Step 2: Transcribe every published Binance tier**

Preserve rate units, maker and taker distinctions, volume windows, balance requirements, token discounts, rebates, and account qualifications.
Label dynamic and account-gated values with their official lookup mechanism.

**Step 3: Add Binance derivatives calculations**

Define contract notional for each derivative family.
Show opening maker and taker fees, closing fees, funding or delivery costs, and round-trip formulas.

**Step 4: Inventory Binance WebSocket APIs**

Record market-specific public endpoints and authenticated user streams.
Cover best bid and ask, ticker, trades, aggregate trades, depth, candles, mark price, index price, funding, liquidations, instruments, orders, fills, balances, and positions where documented.

**Step 5: Document Binance subscriptions and recovery**

Show raw and combined streams.
Show one-symbol and multi-symbol subscriptions.
Explain sequence identifiers, initial snapshots, delta application, reconnects, heartbeats, limits, and timestamp units.

**Step 6: Verify Binance evidence**

Check every numeric row and protocol rule against the linked official source.
Validate every JSON example with a JSON parser.

## Task 3: Research and write the Bybit profiles

**Files:**

- Create: `docs/profiles/bybit/fees.md`
- Create: `docs/profiles/bybit/websocket.md`
- Modify: `docs/README.md`

**Step 1: Inventory official Bybit entities and products**

Locate current schedules for spot, margin, convert, linear derivatives, inverse derivatives, options, loans, wealth products, cards, deposits, withdrawals, and institutional programs.

**Step 2: Transcribe every published Bybit tier**

Record VIP, Pro, market-maker, regional, and product-specific schedules.
Record qualification rules and discounts.

**Step 3: Add Bybit derivatives calculations**

Explain maker and taker costs for linear, inverse, futures, perpetuals, and options.
Include funding, delivery, liquidation, and borrowing rules where applicable.

**Step 4: Inventory Bybit WebSocket APIs**

Record public market-specific endpoints and private endpoints.
Cover order book depths, ticker, trades, candles, liquidation, funding, instrument data, orders, executions, positions, balances, and Greeks where offered.

**Step 5: Document Bybit subscriptions and recovery**

Show multiple topics in one subscription request.
Explain snapshots, deltas, sequence fields, cross-sequences, checksums where applicable, heartbeats, reconnects, and limits.

**Step 6: Verify Bybit evidence**

Check each numeric row and protocol claim against an official source.
Validate every JSON example.

## Task 4: Research and write the OKX profiles

**Files:**

- Create: `docs/profiles/okx/fees.md`
- Create: `docs/profiles/okx/websocket.md`
- Modify: `docs/README.md`

**Step 1: Inventory official OKX entities and products**

Locate current schedules for spot, margin, perpetual swaps, expiry futures, options, convert, loans, earn products, custody, cards, deposits, withdrawals, and institutional programs.

**Step 2: Transcribe every published OKX tier**

Record regular and VIP levels.
Record maker, taker, rebate, volume, asset-balance, and regional qualification rules.

**Step 3: Add OKX derivatives calculations**

Explain contract value and fee formulas for USDT-margined, USDC-margined, and crypto-margined products.
Include funding, delivery, exercise, liquidation, and borrowing costs.

**Step 4: Inventory OKX WebSocket APIs**

Record public, private, business, regional, and demo endpoints.
Cover tickers, trades, books, candles, mark and index prices, funding, liquidations, instruments, orders, fills, positions, balances, and account data.

**Step 5: Document OKX subscriptions and recovery**

Show multiple subscription arguments.
Explain snapshots, incremental updates, sequence identifiers, checksums, heartbeat rules, reconnect recovery, and limits.

**Step 6: Verify OKX evidence**

Check each numeric row and protocol claim against an official source.
Validate every JSON example.

## Task 5: Research and write the Coinbase profiles

**Files:**

- Create: `docs/profiles/coinbase/fees.md`
- Create: `docs/profiles/coinbase/websocket.md`
- Modify: `docs/README.md`

**Step 1: Separate Coinbase entities and platforms**

Distinguish Coinbase Advanced, Coinbase Exchange, Coinbase International Exchange, Coinbase Derivatives, Coinbase Prime, custody, card, staking, and other documented services.
Record jurisdiction and eligibility boundaries for every schedule.

**Step 2: Transcribe every published Coinbase tier**

Record retail, exchange, international, derivatives, prime, institutional, and account-specific schedules that are publicly available.
Label spread-based, dynamic, account-displayed, or negotiated pricing accurately.

**Step 3: Add Coinbase derivatives calculations**

Explain fees for perpetuals, regulated futures, and other offered derivatives.
Record funding, settlement, liquidation, and contract-specific costs.

**Step 4: Inventory Coinbase WebSocket APIs**

Separate Advanced Trade, Exchange, International Exchange, and other current feeds.
Cover ticker or best bid and ask, market trades, level two, full order data where offered, candles, status, futures data, orders, fills, balances, and positions.

**Step 5: Document Coinbase subscriptions and recovery**

Show product arrays and channel arrays for multi-product subscriptions.
Explain authentication, sequence behavior, snapshots, heartbeats, reconnect recovery, and limits for each platform.

**Step 6: Verify Coinbase evidence**

Check each numeric row and protocol claim against an official source.
Validate every JSON example.

## Task 6: Research and write the Kraken profiles

**Files:**

- Create: `docs/profiles/kraken/fees.md`
- Create: `docs/profiles/kraken/websocket.md`
- Modify: `docs/README.md`

**Step 1: Separate Kraken entities and products**

Distinguish Kraken spot, Kraken Pro, margin, Kraken Derivatives, regulated derivatives, custody, staking, cards, deposits, withdrawals, and institutional programs.
Record region and eligibility boundaries.

**Step 2: Transcribe every published Kraken tier**

Record spot pair classes, stablecoin and foreign exchange schedules, margin fees, derivatives tiers, maker rebates, options where offered, and service fees.

**Step 3: Add Kraken derivatives calculations**

Explain maker and taker fees, funding or rollover, settlement, liquidation, and contract notional rules for each derivative family.

**Step 4: Inventory Kraken WebSocket APIs**

Separate spot WebSocket versions and derivatives feeds.
Cover ticker, book, trades, candles, instruments, funding, open interest, liquidations, orders, fills, balances, and positions where offered.

**Step 5: Document Kraken subscriptions and recovery**

Show symbol arrays for multi-symbol subscriptions.
Explain snapshots, updates, checksums, sequence behavior, authentication, heartbeat handling, reconnect recovery, and limits.

**Step 6: Verify Kraken evidence**

Check each numeric row and protocol claim against an official source.
Validate every JSON example.

## Task 7: Build the cross-exchange fee comparison

**Files:**

- Modify: `docs/research/2026-07-26-exchange-fees-comparison.md`

**Step 1: Normalize product coverage**

Map each exchange product name into spot, margin, linear perpetual, inverse perpetual, dated future, option, and non-trading service categories.
Keep venue-specific distinctions visible.

**Step 2: Compare the cost model**

Summarize maker and taker mechanics, qualification windows, funding, financing, settlement, liquidation, discounts, and dynamic fees.
Do not duplicate full tier tables.

**Step 3: Add arbitrage cost guidance**

Define the cost inputs required before a displayed spread can be considered executable.
Include trading fees, slippage, funding, borrow, transfers, conversion, and expected execution failure costs.

**Step 4: Reconcile the source ledger**

Ensure each comparison row links to the detailed profile and official evidence.
Mark every unresolved difference explicitly.

## Task 8: Build the cross-exchange WebSocket comparison

**Files:**

- Modify: `docs/research/2026-07-26-exchange-websocket-comparison.md`

**Step 1: Normalize channel capabilities**

Compare top of book, trades, depth, candles, mark price, index price, funding, liquidations, instrument status, orders, fills, balances, and positions.

**Step 2: Answer the feed selection questions**

Explain when a top-of-book feed is sufficient for discovery.
Explain why depth and private execution feeds are required for reliable executable arbitrage.

**Step 3: Compare multi-symbol subscriptions**

Show the exchange-specific subscription model and any connection or argument limits.

**Step 4: Compare order book correctness**

Summarize snapshot acquisition, update sequencing, checksums, gap detection, and resynchronization.

**Step 5: Add a minimal recommended feed set**

Define a simple staged feed set for discovery, validation, and execution.
Keep this recommendation independent from implementation language or architecture.

## Task 9: Perform the final documentation audit

**Files:**

- Modify: `docs/README.md`
- Modify: `docs/implemented/2026-07-26-exchange-profiles-design.md`
- Modify: `docs/implemented/2026-07-26-exchange-profiles-plan.md`
- Modify: all files created by Tasks 1 through 8

**Step 1: Audit coverage**

Check that all five exchanges have fee and WebSocket profiles.
Check that every profile has scope, freshness, dynamic-fee handling, worked derivatives formulas, and a source ledger.

**Step 2: Audit sources**

Open every official link.
Check that each source supports the nearby claim and applicable entity.
Remove unsupported numbers rather than preserving uncertain values.

**Step 3: Audit examples and arithmetic**

Parse every JSON block.
Recalculate every numerical example.
Check percentage, basis-point, currency, contract, and notional units.

**Step 4: Audit repository rules**

Run:

```bash
git diff --check
rg -n '[;—→↔]| -> ' docs/profiles docs/research docs/plans
rg -L '^# ' docs/profiles/*/*.md docs/research/*.md docs/plans/*.md
```

Expected result:
The diff check is clean.
The prose character scan returns no violations in prose.
Every document has a top-level title.

**Step 5: Check the index**

Confirm that every file under `docs/` has exactly one descriptive line in `docs/README.md`.

**Step 6: Reconcile the design and plan**

Update the design and plan if the verified source landscape required a different structure.
Set the plan status to Done only after all audit steps pass.

**Step 7: Record the version-control boundary**

The managed workspace exposes `.git` as read-only.
Leave the completed documentation changes in the working tree for the user to commit.
Do not stage or modify the user-owned `docs/ROADMAP.md`.

## Reconciliation

Tasks 1 through 8 delivered ten detailed exchange profiles and two cross-exchange comparison documents.
The final audit added the missing Coinbase and Kraken market-data prices and an explicit result for every regional Binance operator named by the official entity disclosure.
It also preserved a conflicting Coinbase Advanced connection limit instead of selecting an unsupported universal value.

All research and profile documents have status Done.
Dynamic, authenticated, negotiated, and live-only values remain explicit production inputs rather than unfinished documentation.
All JSON examples parse, Markdown tables have consistent shapes, internal links resolve, and the docs index lists every document once.
The project lint and test commands pass.

The design and plan are reconciled and archived in `docs/implemented/`.
No runtime code was added.
The user-owned `docs/ROADMAP.md` was not edited.
No commit was created because the managed workspace does not permit writes to `.git`.
