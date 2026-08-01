---
'@amritk/mjst': minor
---

Add `--allowed-roots` so a split spec can reach a sibling directory again

`@amritk/resolve-refs` now confines a local `$ref` to the directory holding the
document it appears in, which closed a real path-traversal hole
(`{"$ref": "/etc/passwd"}` used to be read and inlined). The CLI inherited that
default with no way to widen it, so a completely ordinary multi-version layout —
`specs/v1/api.json` referencing `../common/user.json` — started failing, and the
error told the user to "set allowedRoots", a *library* option nothing on the
command line could reach.

`--allowed-roots <dirs>` is that escape hatch, on both `mjst generate` and
`mjst lint`, alongside an `allowedRoots` config-file key. On the generate path it
takes a comma-separated list or the flag repeated (matching `--allowed-hosts`);
on `lint` you repeat the flag (matching its `--allowed-hosts`). Relative entries
resolve against the current working directory, from a config file as readily as
from the flag, which is how `schema` and `outDir` already behave.

Two things it deliberately does not do. It does not replace the default: the
schema's (or linted document's) own directory stays allowed, so naming a shared
`common/` folder cannot revoke the one directory nobody would think to list. And
it does not widen anything on its own — there is no implicit default drawn from
the config file's location, because a config file usually sits at the repo root
and quietly granting read access to the whole project tree is not a decision
anyone would read into `--config`. A `$ref` that lands outside every named root
is still refused.

Refusals now name the flag that exists (`pass --allowed-roots <dir> …`) instead
of leaving the library's option name as the only lead.
