---
'@amritk/asyncapi': minor
'@amritk/mjst': minor
---

Key channel contracts on the wire tag a payload declares, not the AsyncAPI message name.

**Breaking:** `stripDiscriminator(payload, discriminator, messageName)` is now
`stripDiscriminator(payload, discriminator)` and returns `{ schema, tag? }` — the
message name is no longer an input, because the payload's own `const` is the
better answer. Contract keys change for any document whose message names differ
from its wire tags.

A payload usually states its tag itself (`type: { const: 'bot_added' }`), and
that value is what arrives on the wire. Keying on the message name instead
emitted contracts listening for frames that never come, and skipped every
message whose name disagreed — the AsyncAPI *name* is a document-authoring
handle that 2.x messages inside a `oneOf` often do not have at all. The name is
now only the fallback for a payload that pins nothing. On the vendored Slack RTM
document, `mjst --input asyncapi --message-contracts` goes from 0 of 47 messages
(2.6) and 3 of 47 (3.0) to 45 of 47 in both majors; the two dropped are genuine
collisions, where Slack declares two messages for one wire tag.

Also refused now, with a clear reason: a payload pinning its tag to a non-string,
which no frame could ever be routed by.
