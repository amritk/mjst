# CLI & API Ergonomics

Our CLI (`@amritk/mjst`) and contract-first API (`@amritk/api`) are increasingly
invoked by agents, not just humans. Design their output and behaviour so an
agent can act on a single response without extra round trips, and so a human
still reads it comfortably.

These principles are adapted from the AXI ("Agent eXperience Interface") design
principles: https://github.com/kunchenguid/axi

## Output

- **Keep default output compact.** Prefer a small, well-chosen set of fields
  over dumping everything. For lists, return the 3–4 fields that matter and let
  the caller opt into the rest. Verbose-by-default output wastes tokens and
  buries the signal.
- **Truncate long values, do not drop them.** When a field (a schema, a diff, a
  file body) is large, truncate it, say how much was elided (`… +1.8 kB`), and
  expose a `--full` flag or a follow-up command to fetch the whole thing.
- **Pre-compute aggregates.** If a caller would otherwise have to count or
  re-scan results, include the count/summary yourself (e.g. `3 errors, 1
  warning across 2 files`). Save the round trip.
- **Make empty results explicit.** Return a definite "no results" signal (a
  clear message and a stable exit code), never an ambiguous blank line the
  caller has to guess about.
- **Content first, help second.** When a command can show real data, show it.
  Reserve long help text for `--help`; do not print a wall of usage when the
  user clearly wanted output.

## Machine-readable by default

- **Offer structured output.** Support a `--json` (or equivalent structured)
  mode so callers do not have to parse human prose. Human-formatted output is
  the default; structured output is one flag away.
- **Use stable, meaningful exit codes.** Distinguish success, "ran fine but
  found problems" (e.g. lint findings), and "the tool itself failed". Document
  them. Agents and CI branch on these.
- **Emit structured errors.** An error should carry a stable code/kind and a
  machine-readable location (file, line, JSON pointer) alongside its message —
  not only a sentence. This mirrors what `@amritk/lint` already produces for
  findings; hold the same bar everywhere.
- **Reject unknown flags; never prompt.** Fail loudly on an unrecognised flag
  instead of silently ignoring it, and never block on interactive input in a
  non-interactive context. A hung prompt is worse than a clean error.
- **Keep mutations idempotent.** Re-running a generate/write command with the
  same inputs should converge to the same result, not append or double-apply.

## Guiding the next step

- **Suggest the next action.** After a command, point at what the caller likely
  wants next ("run `mjst generate` to refresh types", "3 findings are
  auto-fixable with `--fix`"). Contextual next-steps turn one command into a
  workflow without the caller memorising the surface.
- **Give consistent, per-subcommand help.** Every subcommand should answer
  `--help` with a concise, uniform reference: what it does, its flags, an
  example. Predictable help is discoverable help.

## Why this matters here

The CLI's whole job is to emit generated code and lint findings, and the API's
job is contract-first request/response. Both are exactly the surfaces where
compact, structured, self-describing output pays off — a caller (human or
agent) should be able to read one response and know what happened, what is
wrong, and what to do next.
