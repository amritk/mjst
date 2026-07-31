---
'@amritk/mjst': minor
---

Stop the CLI from succeeding quietly, and make generation safe to write

**`mjst lint` no longer exits 0 when its file arguments match nothing.** A glob
or path that resolved to zero files fell through to the stdin branch; in CI
there is no TTY, so stdin is an empty pipe and the linter dutifully reported
"No problems found" on an empty document and exited 0. A typo'd path turned a
lint gate into a silent no-op that reported success. Document arguments that
match nothing now exit 2 with `No files matched: …`, and only a run with no
document arguments at all reads stdin.

**`mjst lint` rejects unknown flags.** yargs was built without `.strict()`, so
`--bogus-flag`, a mistyped `--fail-severity`, or a misspelled `--allowed-hosts`
was dropped and the run silently used the defaults — the opposite of the
generate command's deliberate strictness. A non-numeric `--concurrency` now
reports what is wrong instead of crashing with `Invalid array length`.

**Generation never clobbers a file it did not write.** A generated name that
collided with a hand-written file (`index.ts` is the common one) overwrote it
without a word, and `--build` then deleted it along with the other intermediate
sources. Each run records what it wrote in a `.mjst-manifest.json` at the root
of the output directory: paths listed there are reclaimed freely, so
regenerating still needs no ceremony, while anything else aborts the run before
a byte is written. The new `--force` flag opts out. This covers every output the
CLI produces — the parser tree, `--validators`, `--examples`, and `--out-file`,
which is the one most likely to be aimed at hand-written source
(`--out-file src/types.ts` used to overwrite that file silently and, under
`--build`, delete it afterwards). For `--out-file` the manifest lands in the
directory holding the file, alongside the `--build` output and any generated
examples.

**Generation is atomic.** Files are staged under temporary names and renamed
into place only once the whole set has been written, so a mid-run failure (a
`_helpers` path occupied by a regular file, a full disk) leaves the output
directory exactly as it found it instead of a half-generated tree.

**`--root-type` is validated, and writes are confined to the output
directory.** `--root-type '../../Escaped'` — from the command line or from a
config file — wrote outside `--out-dir` and emitted a type name that could not
compile. The name must now be a TypeScript identifier, and the writer
independently refuses any path that resolves outside the output directory.

**Config files are validated.** Every key was guarded by a `typeof` check whose
failure branch was "drop it", so `{"strcit": true, "strict": "true"}` generated
non-strict output and exited 0 while the same typo on the command line was
rejected. Unknown keys and wrong types now fail with the offending pointer and
the expected type, and `config.schema.json` closes the object with
`additionalProperties: false`.

**`-v` / `-h` / `--version` / `--help` are only honored in flag position.** Both
predicates scanned the whole argv, so any flag whose *value* was `-v` (say
`--type-suffix -v`) printed the version, generated nothing, and exited 0.

Smaller argument-parsing fixes: `--` is accepted as the end-of-flags terminator
instead of being rejected as an unknown flag; `--config` with no value is an
error rather than a silently skipped config file; a missing config file reports
`Config file not found: …` instead of a raw `ENOENT`; an `--out-dir` pointing at
an existing file explains itself instead of surfacing `EEXIST … mkdir`; a stray
positional (`mjst genrate --schema …`) is rejected rather than quietly generating
as if the typo were not there; and `--build --types-only` no longer claims to
have built `.js` files that were never emitted.
