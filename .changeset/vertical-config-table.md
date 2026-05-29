---
'@amritk/generate-markdown': patch
'@amritk/mjst': patch
---

Render the config reference as an HTML table with a two-row layout: each property's metadata (name, flag, type, required, default) sits on one row and its description spans the full table width on the row below. This uses vertical space better and stops the description from being squeezed into a narrow column on small screens.
