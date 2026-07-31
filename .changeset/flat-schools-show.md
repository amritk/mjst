---
---

Bench the runtime-validators interpreter directly on every PR, and exercise the
`engines: node >=20` floor in CI.

The interpreter was previously timed only through the `api` suite, which runs it
behind a whole request path — an interpreter regression arrived diluted by
request overhead, and one in a keyword the api contracts happen not to use
arrived not at all, even though `@amritk/lint` runs those keywords on every
schema rule. It now has its own `runtime` suite covering both entry points
(`validateGuard` and the error-collecting `validate`) against valid and invalid
input, with parity checked against Ajv.

`test:dist` — the only thing that runs the shipped artifacts the way a consumer
does — moves into its own job on a Node 20/24 matrix. It previously ran on
whatever Node `ubuntu-latest` happened to carry, so the floor every package
advertises was never exercised.
