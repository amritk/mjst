# Test fixtures

Vendored, real-world YAML documents used by the differential test suite to
exercise the parser against large public specs (not just the synthetic
documents in `bench/fixtures.ts`).

These files live outside `src/` so they are not shipped in the published
package (see the `files` field in `package.json`). They are kept pristine —
byte-for-byte as fetched — so the data we parse matches what the upstream
publisher actually serves.

| File | Source | License |
| --- | --- | --- |
| `digitalocean.yaml` | [`digitalocean/openapi`](https://github.com/digitalocean/openapi) — `specification/DigitalOcean-public.v2.yaml` | Apache-2.0 |

To refresh a fixture, re-fetch it from its source URL and commit the result.
