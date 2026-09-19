---
'@amritk/mjst': patch
---

Stop warning about `--force` on every run. The flag has been a no-op since
0.21.0 and stays one — but it is in the old docs, so everyone who followed them
got a line of noise on every build for a flag that now merely describes the
default. It is still accepted, and the help text still says it is deprecated,
which is where someone looks when they are ready to clean a script up.
