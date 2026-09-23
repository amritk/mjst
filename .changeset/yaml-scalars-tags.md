---
"@amritk/yaml": minor
---

Scalar escapes, tags and merge keys no longer change data silently. Some previously accepted documents now report new problems, and some tagged values project differently:

- **Malformed double-quoted escapes are reported as `BAD_ESCAPE` errors.** This covers `\x`/`\u`/`\U` without exactly 2/4/8 hex digits (`"\u12"`), code points past U+10FFFF (`"\UFFFFFFFF"`), and a backslash before a non-ASCII character (`"\é"`). Any invalid escape, including ones already reported such as `"\."`, now keeps its backslash in the value (`"C:\Users"` stays `C:\Users` instead of becoming `C:Users`), which matches `yaml`. Escaped surrogate pairs (`"\ud83d\ude00"`) still combine into one character.
- **Core tags apply only to text in their own format.** Before, they forced whatever they were given. Now `!!int 1.9`, `!!int "12abc"`, `!!int .inf`, `!!null "x"`, `!!float true` and an empty `!!bool` keep the string as written (they used to become `1`, `12`, `Infinity`, `null`, `true` and `null`) and get a new `BAD_TAG_VALUE` **warning**. The same warning covers invalid `!!binary` base64, a `!!timestamp` that is not a YAML timestamp, `!!omap` entries that are not single pairs or that repeat a key, `!!set` members with values, and a collection tag on the wrong kind of node (`!!set [a]`). The projected values of `!!omap`, `!!set` and `!!binary` do not change.
- **`!!timestamp` follows the YAML timestamp format and reads a missing time zone as UTC.** It used to parse with `new Date()`, so `2001-12-14 21:59:43.10` depended on the host's time zone, and `Dec 14 2001` or `12/14/2001` were accepted. Dates that do not exist (`2001-02-30`) are no longer rolled over into the next month.
- **Tagged mapping keys are keyed by their tagged value.** `!!str 1.50: x` is the key `"1.50"`, not `"1.5"`, so `!!str 1.0` and `1` no longer produce a false `DUPLICATE_KEY` and lose data. `nodeAtPath` finds these keys by the same text.
- **Invalid merge sources are reported as a new `BAD_MERGE` error.** This covers `<<: 5`, `<<: [1, 2]`, an empty `<<:`, and aliases to non-mappings. They are still skipped when projecting.
- **An escaped line break followed by empty lines folds as the spec says.** Each empty line after a `\` continuation becomes a line feed, so `"a\` + empty line + `b"` is `"a\nb"` (as in PyYAML), not `"a b"`.
