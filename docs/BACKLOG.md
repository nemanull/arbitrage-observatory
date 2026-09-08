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
| [`2026-09-07-standing-basis-classification.md`](./backlog/2026-09-07-standing-basis-classification.md) | Not started, four pairs denied by hand | 2026-09-07 | Spreads that never converge run to the age cap every five minutes and top the table, and only index, mark and funding can tell a basis from an arbitrage. |
