#!/usr/bin/env bash
#
# Deprecate the dead-on-arrival 0.7.15 / 0.12.3 releases on npm.
#
# @amritk/mjst@0.7.15 and its dependency @amritk/generate-parsers@0.12.3 crash
# at import time with:
#   SyntaxError: Invalid regular expression: /from '(/: Unterminated group
# The published dist shipped `/from '(/./[^'".]+)'/g` — tsc-alias's
# --resolveFullPaths pass corrupted the intended `/from '(\.\/[^'".]+)'/g`
# during build. The code fix shipped in @amritk/mjst@0.7.16 /
# @amritk/generate-parsers@0.13.0, but the broken versions remain installable.
#
# Requires an npm login with publish rights on the @amritk scope
# (`npm whoami` must succeed). Run once from a machine that has those creds:
#
#   ./scripts/deprecate-broken-releases.sh
#
set -euo pipefail

npm deprecate @amritk/mjst@0.7.15 \
  "broken build (SyntaxError on import) — use >=0.7.16"

npm deprecate @amritk/generate-parsers@0.12.3 \
  "broken build (SyntaxError on import) — use >=0.13.0"
