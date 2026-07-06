/**
 * Usage text printed for `--help`/`-h` and when the CLI is invoked with no
 * arguments. Kept as a hand-written constant because the config schema that
 * documents these flags (config.schema.json) is not shipped in the published
 * package; the help-text test cross-checks that every flag is listed.
 */
export const HELP_TEXT = `mjst — generate TypeScript parsers and type definitions from JSON Schemas

Usage:
  mjst --schema <path> --out-dir <dir> [options]
  mjst --schema-dir <dir> --out-dir <dir> [options]
  mjst --schema <path> --out-file <file> --types-only [options]

Input:
  --schema <path>       Schema to process: a JSON Schema file, or a module when --input is set
  --schema-dir <dir>    Directory of JSON Schemas, processed recursively (instead of --schema)
  --input <format>      Schema source format: json (default), typebox, zod, valibot, effect
  --export <name>       Which export of the schema module to use when --input is not json

Output:
  --out-dir <dir>       Output directory for the generated files
  --out-file <file>     Single-file output instead of a directory (requires --types-only)
  --types-only          Generate type definitions only, without parser functions
  --build               Compile the generated files to .js/.d.ts (implies --import-ext js)
  --import-ext <ext>    Extension on generated relative imports: ts (default) or js
  --helpers <mode>      Runtime helpers: package or embedded (default: auto-detect from package.json)
  --root-type <name>    Root type name for a single --schema run (default: schema title or filename)
  --type-suffix <s>     Suffix appended to every $ref-derived type name
  --banner [text]       Prepend a header comment to every generated file
  --readonly            Emit deeply readonly type definitions

Validation:
  --strict              Throw on type/shape mismatches instead of coercing to defaults
  --strip-unknown       Silently drop undeclared input keys at every nesting level
  --log-warnings        console.warn on input keys not declared in the schema

Misc:
  --config <path>       JSON config file with the same keys; CLI flags take precedence
  --version, -v         Print the CLI version
  --help, -h            Print this help

Docs: https://github.com/amritk/mjst/tree/main/packages/cli#readme
`
