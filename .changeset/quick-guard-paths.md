---
"@amritk/runtime-validators": patch
---

Speed up guard-mode interpretation. `validateGuard` no longer builds instance
path strings while walking (they are only read in error mode), and object
validation avoids redundant `Set` allocations per node. Roughly doubles
guard-mode throughput on typical object schemas with no behavior change.
