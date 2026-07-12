---
"@amritk/resolve-refs": patch
---

Fix two SSRF-guard gaps in remote `$ref` resolution:

- Trailing-dot hostnames (`localhost.`, `api.localhost.`) — the FQDN-root form
  that resolves to the same address — bypassed the by-name loopback check.
  `isPrivateHost` now strips a trailing dot before matching, so these are
  refused by default like their dotless forms.
- The process-global remote document cache was consulted before the SSRF/policy
  check, so a URL fetched once under permissive options (`allowPrivateHosts`, a
  broad `allowedHosts`) could be served to a later call whose options
  (`remote: false`, a stricter host set, or the default private-host guard)
  should refuse it. The policy is now re-evaluated on every remote serve,
  including cache hits.
