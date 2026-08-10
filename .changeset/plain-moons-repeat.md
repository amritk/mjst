---
'@amritk/resolve-refs': patch
'@amritk/mjst': patch
---

Stop the README from tripping a WAF rule in front of the registry, which is what
has refused every publish of these two packages since 2026-08-04.

The 403 was never npm's. `npm publish` embeds the README as plain text in the
publish document, and both READMEs used `../../../etc/passwd` as the example of a
`$ref` that walks out of the schema's directory — the line documenting the
traversal guard. Cloudflare, in front of `registry.npmjs.org`, read that as a
path-traversal attempt and rejected the PUT with its own HTML interstitial. npm
discards the response body, so all that reached the job log was its canned
"forbidden by your security policy" line with no reason attached, and the failure
looked like a registry block on the two package names.

It explains the shape of the outage exactly: these were the only two packages
carrying the string, which is why the other ten published from the same run.
`@amritk/runtime-validators` documents `file:///etc/passwd` and publishes fine —
the rule wants the traversal *and* the `/etc/` path together, and either alone
passes.

The example is now `../../../secrets.env`, which documents the same thing: a path
outside the document tree. No behaviour changes — the guard itself, and the paths
it refuses, are untouched.
