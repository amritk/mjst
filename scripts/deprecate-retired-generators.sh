#!/usr/bin/env bash
#
# Deprecate @amritk/generate-parsers and @amritk/generate-validators on npm.
#
# RUN THIS AFTER the final release of both packages has published, not before.
#
# Both engines now ship inside @amritk/parsers. The last release of each package
# is a compatibility shim over it, published for one reason: npm serves the
# README of the *latest* version, so the signpost pointing at the replacement
# only reaches npmjs.com by shipping it. Deprecating before that publish would
# leave the old README — describing an API that has moved — as the page everyone
# sees.
#
# The ranges are open-ended on purpose: they must cover the final shim release
# too. A deprecated package is deprecated at every version, including the one
# carrying the notice.
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
npm deprecate '@amritk/generate-parsers@*' \
  'merged into @amritk/parsers — call generate(schema, name, { modes: ["types", "parse"] })'

npm deprecate '@amritk/generate-validators@*' \
  'merged into @amritk/parsers — call generate(schema, name, { modes: ["types", "guard", "validate"] })'
