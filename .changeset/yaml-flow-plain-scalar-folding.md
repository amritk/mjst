---
"@amritk/yaml": minor
---

feat(yaml): fold plain scalars that wrap across lines inside flow collections. A plain scalar spanning multiple lines within `[ … ]` / `{ … }` is now folded per YAML 1.2 flow line folding — a single line break becomes a space, a run of *n* breaks yields *n − 1* newlines, and each wrapped line's leading indentation is trimmed — matching `yaml` (eemeli). Previously such a scalar was truncated at the first line break and its value could be silently wrong.
