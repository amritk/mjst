---
"@amritk/yaml": patch
---

Parse faster: about 15–25% on small and medium documents and 9–18% on large ones, on both Node and Bun. The hot character scans (mapping-key colons, plain and flow scalar line ends) settle ordinary characters in one comparison or one table lookup. A plain scalar's stray `: ` is found in the same pass as its line end. Keyword and number resolution dispatches on the first character instead of running a string `switch` and up to four regexes. A line's indentation is measured once instead of once per enclosing block. Under Bun, plain scalars are no longer copied just to read their first character. Output is unchanged: trees, source positions, errors, warnings, comments and `toJS()` are identical to the previous release.
