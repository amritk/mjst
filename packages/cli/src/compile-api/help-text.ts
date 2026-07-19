/**
 * Usage text for `mjst compile-api --help`. Hand-written like the top-level
 * HELP_TEXT: the flag list is small and stable, and the test cross-checks that
 * every flag is listed.
 */
export const COMPILE_API_HELP_TEXT = `mjst compile-api — compile @amritk/api route contracts into a fused fetch-handler module

Usage:
  mjst compile-api <routes-module> --out <file> [options]

The routes module is imported at build time and every export that looks like a
route contract (method, path, responses) becomes a compiled route. The module
must be loadable by the runtime that runs mjst — run via bunx for TypeScript
sources, or under Node install a loader such as tsx (node --import tsx).

Options:
  --out <file>            Output file for the generated module (required; parent dirs are created)
  --routes-import <spec>  Import specifier the generated module uses to import the routes
                          (default: the relative path from the out file to the routes module)
  --options <json-file>   JSON file spread into the compileToModule options for everything
                          not expressible as a flag: contextExport, mounts, info, servers,
                          security, securitySchemes, errorsExport, onErrorExport, ...
                          Flags take precedence over the file.
  --open-api-path <path>  Serve the precomputed OpenAPI JSON at this path (default: /openapi.json)
  --max-body-bytes <n>    Reject larger request bodies with a 413 (default: 1048576; Infinity disables)
  --help, -h              Print this help

Docs: https://github.com/amritk/mjst/tree/main/packages/cli#readme
`
