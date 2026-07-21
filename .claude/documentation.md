# Documentation

How we write and maintain docs across the monorepo — package READMEs, the
`.claude/` guidelines, and reference material. Adapted from the documentation
discipline in https://github.com/kunchenguid/no-mistakes.

## One owner per fact

- **Each fact has exactly one authoritative home.** A config key, an exit code,
  an environment variable, a supported JSON Schema keyword — document it in one
  place. Everywhere else that needs it, link to the owner instead of restating
  it.
- **Stale duplicates become pointers.** When you find the same fact explained in
  two places, do not update both — collapse the weaker copy into a pointer to
  the owner. Two copies drift; one copy plus links does not.
- **Point to the source of truth, do not copy it.** Prefer "see
  `packages/lint/README.md`" or "run `mjst lint --help`" over pasting a table
  that will silently rot. The code and its generated output are the source of
  truth for behaviour; prose should explain intent and link out for detail.
- **Keep top-level READMEs high-level.** The root and each package README should
  orient a reader and hand off to detailed reference. Resist letting them grow
  into exhaustive dumps.

We have `@amritk/generate-markdown` for exactly this reason: generated tables
stay in sync with the schema, so hand-write intent and let generation own the
detail.

## Maintaining the `.claude/` guidelines

These files steer every future agent and contributor session. Hold the bar:

- **Only knowledge useful to almost every session belongs here.** One-off or
  package-specific detail lives with that package, not in a global guideline.
- **Do not repeat what the codebase already shows.** Point to the authoritative
  file, command, or test instead of transcribing it.
- **Prune and rewrite before appending.** When something changes, prefer
  editing or removing the stale entry over stacking a new one on top. These
  files earn their keep by staying short.
- **Keep entries concise and skimmable.** One topic per file (as today: bun,
  typescript, comments, testing, architecture, cli-ergonomics, documentation),
  short bullets, concrete examples.
- **When guidance changes, update every surface that states it** — the
  guideline file and any code comments or README lines that restate the same
  rule — in the same change, so they never disagree.
