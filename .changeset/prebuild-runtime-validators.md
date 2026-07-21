---
---

Fix root `build` so `@amritk/runtime-validators` is compiled before the
`--workspaces` fan-out. `@amritk/mini`'s `forms` subpath imports the validator
as an optional peer, which Bun's workspace runner does not treat as a
build-order edge, so a clean `bun run build` (e.g. the release job, which has
no prior `pretest`) could build `mini` before the validator's `dist` existed
and fail with TS2307. A `prebuild` step (mirroring the existing `pretest`)
builds the validator first.
