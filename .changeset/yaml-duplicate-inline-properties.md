---
'@amritk/yaml': patch
---

Report a second anchor or tag written on one line, instead of dropping the first.

The property scanner reads whatever properties precede a node, and a repeat
simply overwrote what came before: `a: &x &y 1` lost `&x` and `a: !!str !!int 1`
lost `!!str`, both silently. `yaml` and `js-yaml` reject the shape outright. The
multi-line spelling — `&x` on its own line above a `&y` value — was already
caught; this is the same rule applied when both sit on one line, and it reports
once, not twice.

Found by auditing the README against the parser: the `BAD_PROPERTY` row already
claimed this was reported, and it was the one documented diagnostic that could
not be produced.
