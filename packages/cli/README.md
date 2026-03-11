# mjst

Generate TypeScript parsers and type definitions from JSON Schemas.

## Usage

```sh
mjst [options]
```

## Options

| Flag | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| `--schema` | `string` | Yes | Path to the JSON Schema file to process. |
| `--outDir` | `string` | Yes | Output directory for generated TypeScript files. |
| `--types-only` | `boolean` | No | Generate only TypeScript type definitions without parser functions. Useful when you only need the type shapes and do not need runtime validation. |
| `--config` | `string` | No | Path to a JSON config file. Keys match CLI flag names (schema, outDir, typesOnly). CLI flags take precedence over config file values. |
| `--generate-readme` | `boolean` | No | Generate a README.md in the current directory from the CLI config definition and exit. |

## Config File

You can use a JSON config file instead of (or alongside) CLI flags. CLI flags always take precedence over config file values.

```json
{
  "schema": "path/to/schema.json",
  "outDir": "generated"
}
```

```sh
mjst --config config.json
```
