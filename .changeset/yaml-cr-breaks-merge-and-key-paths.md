---
'@amritk/yaml': minor
---

Support lone-`\r` line breaks, stop `<<` dropping inherited-name keys, and make
`nodeAtPath` agree with `toJS()`

Five silent-data-loss bugs, each in a path the differential corpus and the
yaml-test-suite do not reach.

**A lone `\r` truncated the document, with no diagnostic at all.** The scanner
skipped to the next line by looking only for `\n`, so a CR-delimited document had
every line after the first jumped over — `a: 1\rb: 2\rc: 3\r` parsed to
`{ a: 1 }` and reported zero errors, and a single stray CR inside an otherwise-LF
file made one key vanish. YAML 1.2 §5.4 makes all three of `CR LF`, `CR`, and
`LF` a line break, and now so do we — in the parser and in `lineCounter`, so
positions stay exact. `CR LF` still counts once. The differential suite re-runs
every case in all three break styles.

**`<<` dropped any merged key that shares a name with an `Object.prototype`
member.** The "does the target already have this key?" test walked the prototype
chain, so `toString`, `valueOf`, `constructor`, `hasOwnProperty`,
`isPrototypeOf`, `__proto__` and friends were silently discarded from the merge.
Only own keys shadow a merged one now; `__proto__` is still defined as plain data
rather than assigned through the prototype setter, so the pollution guard holds.

**`nodeAtPath` could not find the keys `toJS()` produces.** It carried its own
simplified key-stringifier that returned `'null'` for a null key, `'*ref'` for an
alias key, and `''` for every collection key — so `null: v`, `*a : v`, and
`[a, b]: v` were unreachable by path, and a `closest: true` lookup quietly
returned the *parent's* source span: a diagnostic pointing at the wrong line. It
now uses the parser's own projection, which is exported as `keyText` for anyone
building paths by hand.

**An unterminated quoted scalar lost its last character.** The recovery sliced
off a closing quote that was never there, so `a: "abcd` recovered as `"abc"` —
the wrong text for a linter to echo back. The `UNTERMINATED_QUOTE` error was
always correct; the text now is too.

**`parseDocument` truncated a `---` stream without saying so.** Reading only the
first document is intended, but a caller on `parse()` sees only the data. It now
pushes a `MULTIPLE_DOCUMENTS` warning pointing at the marker and naming
`parseAllDocuments`. A trailing marker with nothing under it stays quiet.

Also: `lineCounter` builds its index with `indexOf` instead of a per-character
loop — 2.6–3.6× faster, taking it from ~18% of parse+index cost to ~6%. And the
bundle-size benchmark now bundles a consumer of each parser rather than the
barrel, which tree-shook to a 156-byte stub and made the README's size table
fiction; the corrected numbers are in the README.
