# @turystack/proof-mode-gates

The gate runner. It orchestrates the gate ladder, executes the structural checks the skills bind to, and emits a report whose verdict is **computed** from the gates and the evidence rather than declared in a payload.

## Installation

```bash
pnpm add -D @turystack/proof-mode-gates
```

## Usage

```bash
turystack-proof next               # what is open, and why - deterministic, no LLM
turystack-proof next --json        # the same rows, for a script or an agent
turystack-proof next --markdown    # the same, as a digest to paste or pipe
turystack-proof run --dry-run      # the rungs it would run, and on what - runs nothing
turystack-proof structure          # the gate:* checks, with violations
turystack-proof structure --json   # machine-readable
turystack-proof report --out .     # gate-report.json + gate-report.html
turystack-proof skill .            # validate one skill package on its own
turystack-proof howto <skill-dir>  # the start-here comments a materialized
turystack-proof howto <dir> --strip  # project skill ships with: list, or remove
```

## What is open, before anything is run

`next` answers the question `07-routine.md` opens a session with - implement,
audit, or hunt - from the board, the spec and the reports rather than from
memory. It reads files and nothing else, so it is free to run on every commit.

```text
  ! AC-7   uncovered  declared in .claude/skills/acme-spec/04-rules.md and no task names it
  ~ T-1    stale      AC-1 moved in the spec since the report proved it
  → T-2    ready      cases approved by ana · covers AC-3
  · T-3    waiting    its cases have not been approved by a person
```

`stale` is the one that needs the other half. A report emitted with
`--covers AC-1,AC-2` carries `task.specHash`: the digest of each decision's text
**as the runner read it from disk**, never as the payload declares it. A later
`next` compares that against the spec now, so a task whose decisions have not
moved produces no line at all - and one whose report recorded no digest is
`unproven` rather than quietly counted as fresh.

```bash
turystack-proof report --covers AC-1,AC-2 --out .
```

## Red that survives the session

`run --task <id>` records what the run concluded in `ledger.json`, beside the
board. Green clears the entry; red increments a count and names **the rung that
failed** - which the ladder already knows, so nothing has to guess it from a log.

After three failures a task enters a six-hour backoff and stops being offered by
`next`, with a line saying when it comes back. A task that fails three runs is
not a hard task; it is a task whose spec, cases or environment is wrong, and
offering it again forty minutes later teaches people to stop reading the list.

```text
  · T-1   waiting   3 failed run(s), last on structure — backing off until 2026-08-26T03:23:38Z
```

The file is committed on purpose: the point is that the history outlives the
session that produced it. Entries nothing has touched in 90 days are pruned on
every save, so it stays a file people open.

## The ladder before the ladder

Nothing here schedules itself, and nothing should be pointed at a real project
for the first time in anger. In order:

```bash
turystack-proof next                       # read the rows; do they describe reality?
turystack-proof run --dry-run --task T-4   # what would run, what would be written
turystack-proof run --task T-4 --covers AC-1,AC-2   # one supervised task
turystack-proof next                       # it should have gone quiet, or said why not
```

The last step is the one that matters: a task that stays on the list after a
green run means the digests never landed, and finding that out on one task is
cheaper than finding it out on forty.

## What the report keeps

`emit` writes the five things the runner computes - `ladder`, `structure`,
`provenance`, `schema` and the recomputed `verdict` - over whatever payload is
already there, and **keeps** the blocks it did not produce: `backend`,
`frontend`, `law`, `contractDelta`, `context`. The `task` block is merged key by
key, so a runner stamping `covers` and `specHash` does not erase the `id` and
`title` somebody else wrote.

The verdict is never carried across. It is recomputed over the merged object,
which is the only reading of `DLV-14` that survives a merge: a report that kept
a `verdict` key would keep a green it no longer earns. Pass `--no-merge` to
overwrite outright.

A freshly materialized `<project>-spec` or `<project>-uiux` arrives with
`turystack:howto` comments explaining how to start it. They stop being true the
moment someone does, so removing them is a command rather than a chore. The
`turystack:unfilled` markers are left alone — those are decisions, and they go
when someone makes them.

## What it is, and what it is not

| | |
|---|---|
| **This package** | runs the ladder, the `gate:*` checks, and emits the report |
| `@turystack/backend-config` / `-frontend-config` | ship the Biome config and the `grit:*` plugins |
| `turystack-proof-mode` | the skill that says when to run it and what must be proven |
| `turystack-harness` | the skill that says whether the project is ready to be coded in at all |

The `grit:*` rules do **not** live here: a GritQL plugin is loaded by Biome, and
a plugin path does not resolve through `extends` from `node_modules` — so the
`.grit` files ship with the config packages and the project declares them in its
own `biome.json`.

## Pending is not passing

A skill declares more `gate:` bindings than this runner implements. The
unimplemented ones are carried into the report as **`pending`**, never dropped
and never counted as green. A report that silently omits what it could not check
is a report claiming coverage it does not have.

## Documentation

**https://tury.dev/libs/proof-mode-gates**
