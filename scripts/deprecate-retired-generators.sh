#!/usr/bin/env bash
#
# Deprecate @amritk/generate-parsers and @amritk/generate-validators on npm.
#
# Both engines now ship inside @amritk/parsers, which reaches every mode they
# had through one `generate()` call. The two package directories in this repo
# are `private: true` stubs, which stops *this repo* from publishing those names
# again but does nothing to npm — every published version stays installable and
# undeprecated until this runs.
#
# Because they are private, there will never be a final "deprecated" release to
# carry the notice in a manifest. `npm deprecate` against the published range is
# the whole mechanism, which is why it is a script rather than a release step.
#
# The ranges cover every version ever published: 0.24.0 and 0.18.0 are `latest`
# for the two packages respectively. Re-run with a wider bound if that changes.
#
# Requires an npm login with publish rights on the @amritk scope (`npm whoami`
# must succeed). The release workflow publishes through trusted publishing
# (OIDC), which `npm deprecate` cannot use — so this runs from a machine with
# real credentials, once:
#
#   ./scripts/deprecate-retired-generators.sh
#
# To undo, deprecate again with an empty message: npm deprecate <pkg>@<range> ""
set -euo pipefail

# Single-quoted, and no backticks: inside a double-quoted bash string a backtick
# opens a command substitution, so a message wrapping code in backticks is
# silently truncated at the first one rather than failing loudly.
npm deprecate '@amritk/generate-parsers@<=0.24.0' \
  'merged into @amritk/parsers — call generate(schema, name, { modes: ["types", "parse"] })'

npm deprecate '@amritk/generate-validators@<=0.18.0' \
  'merged into @amritk/parsers — call generate(schema, name, { modes: ["types", "validate"] })'
