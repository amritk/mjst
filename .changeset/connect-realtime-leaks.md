---
'@amritk/api': patch
---

`connectRealtime` no longer leaks a connection when an attempt is abandoned.

When the connect deadline or the caller's `signal` won the race, both arms threw
without closing what they had opened — the abort listener that would have closed
it is registered only after the await. The socket or session kept connecting,
could open, and then stayed open and unread on both ends: one leak per fallback
attempt, on the path the fallback exists to take.

The WebTransport arm also left its `closed` promise unclaimed on that path. It
rejects when the session dies, and the return object carrying its handler is
never built when the attempt fails, so the rejection was unhandled — a crash in
Node, a console error in a browser. It is claimed as soon as the session is
constructed now. This is the transport tried *first* by default, and its
deadline exists precisely for QUIC that hangs rather than fails, so this was the
common path.
