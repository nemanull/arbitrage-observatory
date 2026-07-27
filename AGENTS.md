# AGENTS.md

Project-wide rules for AI agents and humans working in this repository.
These rules apply to all code and docs under this repo, including [`app/`](./app/) and [`server/`](./server/).

Documentation has its own rules in [docs/AGENTS.md](./docs/AGENTS.md).
Read that file before creating, editing, moving, or indexing anything under [`docs/`](./docs/).

## 1. Comments and documentation

Comments are important and should be written.
Comments must never be insanely huge.
Inline comments must not contain examples.

Every function requires a JSDoc block (RustDoc for Rust) that helps AI agents understand intent and usage.
For public functions, the JSDoc must include a usage example.
When editing existing code, if you see a function without documentation, add it.

Exception: small and self-explanatory functions do not need JSDoc.
A short `//` comment is enough for them, or no comment at all if the name says everything.

## 2. Prose style in comments and docs

One complete sentence per line.
Never break a line mid-sentence.
A long sentence may exceed 80 columns rather than be cut, because Prettier does not reflow comment prose and there is no max-len rule.
Still, it is much better to split one huge sentence into two short ones.

Keep sentences short and plain.
Do not join two ideas with a semicolon or an em-dash.
Split them into separate sentences.

No arrow characters in prose.
That means no →, no ↔, and no ASCII ->.
Write the word "to", or "between X and Y".

## 3. Logging

Logging is critical in this project because most work happens in background jobs.
Use Nest's default logger on the server.
A comparable alternative may be chosen for React and Rust in the future.
Every job and pipeline stage transition should produce a log line with enough context to trace the item it processed.

## 4. Clean code

No huge functions.
Ideally, a class or function stays under 700 lines.
This is a strong recommendation, not a 100% rule.

## 5. Simplicity

The system will be complicated, so we keep each part as simple as possible while still covering all cases.
If a plain for loop solves the problem, do not build a separate service that does the same thing.
Prefer the boring solution unless there is a concrete reason not to.
