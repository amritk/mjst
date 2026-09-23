---
"@amritk/api": patch
---

Harden request parsing in two places.

- A form body or query string made of `=`-less pairs followed by one late `=` made the parser rescan to that `=` for every pair, which is quadratic: a 1 MiB body, inside the default `maxBodyBytes`, took about 1.7s of CPU. The parser now carries the next `=` across pairs and takes about 40ms on the same body. The `cookie` header parser had the same loop and gets the same fix.
- `fetchToNodeHandler` built the request URL by splicing the client's `Host` header in front of the path, so `Host: example.com/admin` routed a request for `/public` to `/admin/public`, past any proxy rule that only allowed `/public`. A `Host` that is not a plain host name or IP literal with an optional port is now replaced by `localhost`. `Bun.serve` builds `request.url` from `Host` the same way, so `toFetchHandler` on Bun still depends on the platform.
