# Backlog

Work that is identified but not scheduled.
[`ROADMAP.md`](./ROADMAP.md) holds the committed stages, and this file indexes everything found along the way that has no stage yet.
Rules for this tree live in [AGENTS.md](./AGENTS.md).

Each entry is one file under [`backlog/`](./backlog/), and every entry gets one row below.
An entry states the finding, the evidence behind it, and what finishing the work would mean.
An entry leaves the backlog when it becomes a dated design under [`plans/`](./plans/).
Rows are not ordered by priority.

| Entry | Status | Recorded | Summary |
| --- | --- | --- | --- |
| [`2026-09-05-dynamic-taker-fee-resolution.md`](./backlog/2026-09-05-dynamic-taker-fee-resolution.md) | Not started | 2026-09-05 | A taker fee is one static number per venue, and the real rate depends on the account, the product line, and the symbol. |
| [`2026-09-05-coinbase-derivatives-cutover.md`](./backlog/2026-09-05-coinbase-derivatives-cutover.md) | Not started | 2026-09-05 | Coinbase International derivatives move to a Deribit powered gateway on 2026-09-09, and the perpetual product ids change with no parallel running window. |
| [`2026-09-05-cluster-identity-and-unit-normalisation.md`](./backlog/2026-09-05-cluster-identity-and-unit-normalisation.md) | Not started, temporary patch in place | 2026-09-05 | Clusters are keyed on the ticker alone, so different assets and different contract units are compared; 0.7% of clusters produced 53% of the rows. |
| [`2026-09-07-standing-basis-classification.md`](./backlog/2026-09-07-standing-basis-classification.md) | Done | 2026-09-07 | Spreads that never converge run to the age cap every five minutes and top the table, and only index, mark and funding can tell a basis from an arbitrage. |
| [`2026-09-08-judgment-inputs.md`](./backlog/2026-09-08-judgment-inputs.md) | In progress, issue #3 closed | 2026-09-08 | The engine judges a row from two touches and never reads index, mark, funding, per leg age, the underlying's session, tradability limits or venue participation, so no rule can tell a basis, an off-hours equity, a dust order or a flash from an arbitrage. |
| [`2026-09-15-open-gate-safeguards.md`](./backlog/2026-09-15-open-gate-safeguards.md) | Not started | 2026-09-15 | Every gate on the open path judges what a quote says and none judges when it was true, so a stale leg, a memoryless fresh gate and an unread own spread account for 58 of the fifth run's 66 rows. |
