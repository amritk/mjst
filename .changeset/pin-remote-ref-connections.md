---
"@amritk/resolve-refs": minor
---

Remote `$ref` fetches now connect only to the addresses the SSRF guard verified. Previously the DNS check (`verifyDns`) and the connection each resolved the host name separately, so a DNS-rebinding record could answer the check with a public address and the connection with a private one (`127.0.0.1`, `169.254.169.254`, an RFC 1918 host), and the response was returned to the caller. The check now runs inside the connection's own lookup, so a name is resolved once per connection and every redirect hop is pinned the same way. `Host`, SNI and certificate checks still use the host name.

What changes for callers: when the DNS check is on (the default, unless `verifyDns: false`, `allowPrivateHosts`, or `allowedHosts` is set) and no `fetch` option is passed, remote documents are fetched with a built-in `node:http`/`node:https` client instead of the global `fetch`. Code that intercepted those requests by replacing `globalThis.fetch` must pass its client as the `fetch` option instead. A custom `fetch` makes its own connections and cannot be pinned, so for it the DNS check is still a pre-flight that a rebinding record can get past. A DNS answer that is not an IP address is now refused.

Thanks to Vishal Suwalka (@vsuwalka01) for reporting this.
