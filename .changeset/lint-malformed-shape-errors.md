---
'@amritk/lint': patch
---

Name the malformed part of a ruleset instead of failing deep inside it.

Following on from the malformed-rule-entry fix, five more shapes surfaced as a
`TypeError` from wherever the value was first touched: `overrides` that is not an
array ("overrides is not iterable"), an override with no `files` globs ("Cannot
read properties of undefined (reading 'filter')" — once per linted document,
because `files` is read per document), a `formats` gate that is not an array
("number 5 is not iterable"), an `extends` entry that is neither a string nor a
ruleset object, and a definition that is not an object at all ("Invalid value
used as weak map key", from the memoization layer). Each is now a named error
raised while the ruleset is built.
