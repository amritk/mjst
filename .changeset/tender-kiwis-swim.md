---
---

Strip the `development` export condition from every package manifest at publish
time. The condition points at raw `./src/*.ts`, which ships in the tarball, so
removing it on release keeps consumers on the built JS in `dist`. Tooling-only
change with no effect on published package contents.
