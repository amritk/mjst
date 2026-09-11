/**
 * Usage text for `mjst markdown --help`. Hand-written like the top-level
 * HELP_TEXT: the flag list is small and stable, and the test cross-checks that
 * every flag is listed.
 */
export const MARKDOWN_HELP_TEXT = `mjst markdown — generate markdown documentation from a JSON Schema

Usage:
  mjst markdown <schema> --out-dir <dir> [options]
  mjst markdown <schema> --table --readme <file>

Two shapes come out of the same schema. By default it writes the prose
reference — a heading, a type, the description and an example per property,
across as many pages as the schema's x-doc keyword declares. With --table it
renders one HTML table instead and splices it into an existing markdown file
between <!-- config-table-start --> and <!-- config-table-end -->, leaving the
rest of that file alone.

Prose reference options:
  --out-dir <dir>      Directory the pages are written to (default: the current directory)
  --file <path>        Output path of the index page (default: the schema's x-doc.file, then index.md)
  --title <text>       Page title (default: the schema's title)
  --language <lang>    Fence language for derived examples and literals (default: json)
  --layout <mode>      Default layout for nested properties: headings (default), table, or none
  --sort <order>       Property order: schema (default) or alphabetical
  --heading-level <n>  Heading level of the page title, 1-6 (default: 1)

Table options:
  --table              Render the HTML config table instead of the prose pages
  --readme <path>      Markdown file the table is spliced into (default: README.md)

Misc:
  --help, -h           Print this help

Docs: https://github.com/amritk/mjst/tree/main/packages/cli#readme
`
