#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { getAdapter } from '@amritk/adapters/get-adapter'
import { buildSchema } from '@amritk/generate-parsers'
import { deriveRootTypeName } from '@amritk/helpers/derive-root-type-name'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

const execFileAsync = promisify(execFile)

import type { CliConfig } from './cli-config'
import { detectHelpersMode } from './detect-helpers-mode'
import { loadConfig } from './load-config'
import { loadSchemaModule } from './load-schema-module'
import { parseCliArgs } from './parse-cli-args'

/**
 * Extracts the --config flag value from process args before full parsing.
 * We need this early so we can load the config file first, then overlay CLI flags.
 */
const extractConfigPath = (args: readonly string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--config' && args[i + 1] && !args[i + 1]?.startsWith('--')) {
      return args[i + 1]
    }

    if (arg?.startsWith('--config=')) {
      return arg.slice('--config='.length)
    }
  }

  return undefined
}

/** Reads a JSON Schema off disk, or loads a module and converts it via its adapter. */
const loadSchema = async (config: Partial<CliConfig>, schemaPath: string): Promise<unknown> => {
  const inputFormat = config.input ?? 'json'

  if (inputFormat === 'json') {
    return JSON.parse(await readFile(schemaPath, 'utf-8'))
  }

  console.log(`Input format: ${inputFormat}`)
  const source = await loadSchemaModule(schemaPath, config.export)
  return getAdapter(inputFormat).toJSONSchema(source)
}

/** Writes a generated file, creating any parent directories the filename implies. */
const writeGeneratedFile = async (baseDir: string, filename: string, content: string): Promise<void> => {
  const filePath = join(baseDir, filename)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

/**
 * Compiles the generated `.ts` files to `.js`/`.d.ts` with a temporary tsconfig,
 * then removes the intermediate sources. `tsFiles` are paths relative to `outputDir`.
 */
const buildOutput = async (outputDir: string, tsFiles: readonly string[], typesOnly?: boolean): Promise<void> => {
  // Write a minimal tsconfig so tsc can compile the generated files without
  // inheriting settings like allowImportingTsExtensions that block emission.
  // In 'package' mode tsc finds @amritk/helpers via the consumer's node_modules.
  // In 'embedded' mode the helpers live under ./_helpers and need no resolution.
  const tsconfigContent = JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        declaration: true,
        emitDeclarationOnly: typesOnly,
        skipLibCheck: true,
      },
      include: ['./**/*.ts'],
    },
    null,
    2,
  )

  const tsconfigPath = join(outputDir, '.tsconfig-mjst-build.json')
  await writeFile(tsconfigPath, tsconfigContent, 'utf-8')

  try {
    await execFileAsync('npx', ['tsc', '--project', tsconfigPath])
  } catch {
    throw new Error('TypeScript compilation failed. Check the generated files for errors.')
  } finally {
    await unlink(tsconfigPath)
  }

  // Remove the intermediate .ts files now that .js and .d.ts have been produced
  for (const file of tsFiles) {
    await unlink(join(outputDir, file))
    console.log(`Built: ${file.replace(/\.ts$/, '.js')}`)
    console.log(`Built: ${file.replace(/\.ts$/, '.d.ts')}`)
  }

  console.log(`\nTotal files built: ${tsFiles.length * 2}`)
}

/** Recursively collects every `*.json` file under `dir`, returning absolute paths. */
const findJsonSchemas = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const results: string[] = []

  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await findJsonSchemas(full)))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(full)
    }
  }

  return results
}

/** Generates parsers for a single schema (the original one-schema-in, one-outDir-out flow). */
const runSingle = async (config: Partial<CliConfig>, schemaPath: string, outputDir: string): Promise<void> => {
  const schema = await loadSchema(config, schemaPath)

  await mkdir(outputDir, { recursive: true })

  const helpersMode = config.helpers ?? detectHelpersMode(outputDir)
  console.log(`Helpers mode: ${helpersMode}${config.helpers ? ' (explicit)' : ' (auto-detected)'}`)

  const rootTypeName = deriveRootTypeName(schema)
  console.log(`Root type: ${rootTypeName}`)

  const files = await buildSchema(
    schema as JSONSchema,
    rootTypeName,
    undefined,
    config.typesOnly,
    config.logWarnings,
    config.strict,
    helpersMode,
  )

  for (const file of files) {
    await writeGeneratedFile(outputDir, file.filename, file.content)
    console.log(`Generated: ${file.filename}`)
  }

  if (config.build) {
    await buildOutput(
      outputDir,
      files.map((f) => f.filename),
      config.typesOnly,
    )
  } else {
    console.log(`\nTotal files generated: ${files.length}`)
  }
}

/**
 * Generates parsers for every JSON Schema under `schemaDir`, mirroring the directory
 * layout into `outDir`. Each schema's output lands in its own subdirectory (so files
 * from different schemas never collide) and the runtime helpers are emitted once into a
 * shared `outDir/_helpers/` that every nested parser imports from.
 */
const runRecursive = async (config: Partial<CliConfig>, schemaDir: string, outputDir: string): Promise<void> => {
  if (config.input && config.input !== 'json') {
    console.error("Error: --schemaDir only supports JSON Schema files; remove --input or set it to 'json'.")
    process.exit(1)
  }

  const schemaFiles = await findJsonSchemas(schemaDir)

  if (schemaFiles.length === 0) {
    console.error(`Error: no .json schema files found under ${schemaDir}.`)
    process.exit(1)
  }

  await mkdir(outputDir, { recursive: true })

  const helpersMode = config.helpers ?? detectHelpersMode(outputDir)
  console.log(`Helpers mode: ${helpersMode}${config.helpers ? ' (explicit)' : ' (auto-detected)'}`)

  // Helper sources are identical across schemas, so collect them by filename and
  // write the deduplicated set once at the output root.
  const sharedHelpers = new Map<string, string>()
  const writtenTsFiles: string[] = []

  for (const schemaFile of schemaFiles) {
    const relPath = relative(schemaDir, schemaFile)
    const relNoExt = relPath.slice(0, -'.json'.length)
    const schemaSubDir = join(outputDir, relNoExt)
    // Depth of the schema's output subdirectory, used to build the relative import
    // path back to the shared `_helpers/` at the output root (../, ../../, ...).
    const depth = relNoExt.split(sep).filter(Boolean).length
    const helpersImportPrefix = '../'.repeat(depth)

    const schema = await loadSchema(config, schemaFile)
    const rootTypeName = deriveRootTypeName(schema)
    console.log(`\n${relPath} → ${relNoExt}/ (root type: ${rootTypeName})`)

    const files = await buildSchema(
      schema as JSONSchema,
      rootTypeName,
      undefined,
      config.typesOnly,
      config.logWarnings,
      config.strict,
      helpersMode,
      helpersImportPrefix,
    )

    for (const file of files) {
      if (file.filename.startsWith('_helpers/')) {
        sharedHelpers.set(file.filename, file.content)
        continue
      }

      await writeGeneratedFile(schemaSubDir, file.filename, file.content)
      const relativeFilename = join(relNoExt, file.filename)
      writtenTsFiles.push(relativeFilename)
      console.log(`Generated: ${relativeFilename}`)
    }
  }

  for (const [filename, content] of sharedHelpers) {
    await writeGeneratedFile(outputDir, filename, content)
    writtenTsFiles.push(filename)
    console.log(`Generated: ${filename}`)
  }

  if (config.build) {
    await buildOutput(outputDir, writtenTsFiles, config.typesOnly)
  } else {
    console.log(`\nTotal files generated: ${writtenTsFiles.length}`)
  }
}

const run = async (): Promise<void> => {
  // Skip the first two args (node executable and script path)
  const args = process.argv.slice(2)

  const configPath = extractConfigPath(args)

  // Start with config file values if provided, then overlay CLI flags on top
  const fileConfig = configPath ? await loadConfig(configPath) : {}
  const cliConfig = parseCliArgs(args)
  const config = { ...fileConfig, ...cliConfig }

  if (!config.outDir) {
    console.error('Error: --outDir is required. Provide an output directory for generated files.')
    process.exit(1)
  }

  const outputDir = resolve(config.outDir)

  // schemaDir activates recursive mode and takes precedence over a single schema.
  if (config.schemaDir) {
    await runRecursive(config, resolve(config.schemaDir), outputDir)
    return
  }

  if (!config.schema) {
    console.error('Error: --schema (or --schemaDir) is required. Provide a path to a JSON Schema.')
    process.exit(1)
  }

  await runSingle(config, resolve(config.schema), outputDir)
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
