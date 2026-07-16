---
"@amritk/resolve-refs": patch
---

Close an SSRF-guard gap for IPv4-in-IPv6 addresses. `isPrivateHost` only decoded the IPv4-**mapped** form (`::ffff:X:Y`), so the WHATWG-URL-normalized hex of an IPv4-**compatible** address slipped through: `http://[::127.0.0.1]/` normalizes to `::7f00:1` and `http://[::169.254.169.254]/` (cloud metadata) to `::a9fe:a9fe`, neither of which the mapped-only check matched — and `denialReason` then allowed the fetch. The guard now fully expands the IPv6 address and rejects every private IPv4 embedding the URL parser can produce (compatible `::X:Y`, mapped `::ffff:X:Y`, translated `::ffff:0:X:Y`, and NAT64 `64:ff9b::/96`), plus the fully-expanded loopback `0:0:0:0:0:0:0:1`. Public embeddings (e.g. `::ffff:1.1.1.1`) remain allowed.
