---
"@amritk/generate-markdown": minor
---

Only render columns and icons the schema actually uses. The **CLI Flag**,
**Required**, and **Default** columns are now dropped entirely when no property
anywhere in the schema fills them (the check spans nested objects so every table
keeps a consistent shape), and properties without an `x-icon` no longer get a
fallback icon. Empty cells are left blank instead of showing an `—` placeholder.
