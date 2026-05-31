---
---

Strip the `development` export condition from every package manifest at publish
time. The condition points at raw `./src/*.ts`, so removing it on release keeps
consumers on the built JS in `dist`. Also drop `src` from each package's `files`
allowlist so the source no longer ships in the tarball, and stop emitting
declaration maps now that there is no source for them to point at. Tooling and
packaging change with no effect on the runtime contents of `dist`.
