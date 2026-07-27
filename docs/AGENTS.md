# Docs AGENTS.md

Rules for everything under [`docs/`](./).
The prose style rules from the root [AGENTS.md](../AGENTS.md) apply to every doc here.

## Layout

- `plans/` holds active design docs and implementation plans.
- `research/` holds investigation dumps and feasibility studies that inform a plan but are not a plan.
  Research stays here permanently, even after the work ships.
- `implemented/` is the archive of shipped work.
  Reconciled designs and plans move here when their work is done.
- [`README.md`](./README.md) is the index.
  Every doc in this tree gets one line there.
- `plans/`, `research/`, and `implemented/` are created on first use, not preemptively.
  None of them exist yet, which is why they appear here as code spans rather than links.

## Lifecycle

Work flows through stages: research, design, plan, execute, reconcile.

1. Research lands in `research/` as a dated doc.
2. A design doc is written in `plans/` after the approach is discussed and approved.
   It records a numbered Decisions log, where each approved decision is stated as a commitment.
   It also records rejected alternatives together with the reason they were rejected.
   Where a claim depends on existing code, it cites the file and line as evidence.
3. An implementation plan is written in `plans/` once the design is approved.
   It names the design of record it implements.
   It contains a scope guard: an explicit list of what this work does not do.
   It breaks the work into numbered tasks with the exact files to modify.
4. Execution follows the plan.
5. Reconcile before finishing.
   Every plan and design that guided the work is audited against what actually shipped.
   Where implementation diverged, the doc is edited to describe what was built.
   A doc is never left asserting an abandoned approach.
   The reconciled design and plan then move to `implemented/`, and [`README.md`](./README.md) is updated.
   Research does not move, only plans do.

## Naming and linking

- Filenames are kebab-case and date-prefixed: `YYYY-MM-DD-<topic>-design.md` for designs, `YYYY-MM-DD-<topic>-plan.md` for plans.
- No `v2`, `final`, or similar suffixes.
  Git history covers versions.
- Links between docs are relative and clickable, and the target always starts with `./` or `../`.
  A doc in the same folder: `[README.md](./README.md)`.
  A doc in the parent folder: `[AGENTS.md](../AGENTS.md)`.
  A doc in a subfolder: `[docs/AGENTS.md](./docs/AGENTS.md)`.
  A folder rather than a file: `[docs/](./docs/)`, with the trailing slash kept.
- The link text is the path or the file name, not a rewritten phrase.
  Write [`README.md`](./README.md) as its own link, not "the index" pointing at it.
- Every path a doc references must exist at the time of writing.
  A path that does not exist yet stays a plain code span, never a link.

## Status and size

- Status trackers use exactly four tokens: Done, In progress, Not started, Blocked.
- 400 lines is a readability warning for reference docs.
  It is not a limit for design docs and plans.
  Detail that an agent needs to execute or verify the work must not be trimmed.
