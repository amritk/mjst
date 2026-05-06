#!/usr/bin/env bun
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { buildSchema } from '@amritk/generate-parsers'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { loadConfig } from './load-config'
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

const run = async (): Promise<void> => {
  // Skip the first two args (node executable and script path)
  const args = process.argv.slice(2)

  const configPath = extractConfigPath(args)

  // Start with config file values if provided, then overlay CLI flags on top
  const fileConfig = configPath ? await loadConfig(configPath) : {}
  const cliConfig = parseCliArgs(args)
  const config = { ...fileConfig, ...cliConfig }

  if (!config.schema) {
    console.error('Error: --schema is required. Provide a path to a JSON Schema file.')
    process.exit(1)
  }

  if (!config.outDir) {
    console.error('Error: --outDir is required. Provide an output directory for generated files.')
    process.exit(1)
  }

  const schemaPath = resolve(config.schema)
  const raw = await readFile(schemaPath, 'utf-8')
  const schema: unknown = JSON.parse(raw)

  const files = await buildSchema(schema as JSONSchema, 'Document', undefined, config.typesOnly, config.logWarnings)

  const outputDir = resolve(config.outDir)
  await mkdir(outputDir, { recursive: true })

  for (const file of files) {
    const filePath = join(outputDir, file.filename)
    // Create subdirectories if the filename contains a path
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, file.content, 'utf-8')
    console.log(`Generated: ${file.filename}`)
  }

  if (config.build) {
    // Write a minimal tsconfig so tsc can compile the generated files without
    // inheriting settings like allowImportingTsExtensions that block emission.
    // Add paths so tsc can resolve @amritk/helpers from the output directory.
    const helpersDir = resolve(import.meta.dir, '../../helpers/dist')
    const helpersRelative = relative(outputDir, helpersDir)
    const tsconfigContent = JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'bundler',
          declaration: true,
          emitDeclarationOnly: config.typesOnly,
          skipLibCheck: true,
          paths: {
            '@amritk/helpers/*': [`${helpersRelative}/*`],
          },
        },
        include: ['./**/*.ts'],
      },
      null,
      2,
    )

    const tsconfigPath = join(outputDir, '.tsconfig-mjst-build.json')
    await writeFile(tsconfigPath, tsconfigContent, 'utf-8')

    try {
      await Bun.$`bunx tsc --project ${tsconfigPath}`.quiet()
    } catch {
      throw new Error('TypeScript compilation failed. Check the generated files for errors.')
    } finally {
      await unlink(tsconfigPath)
    }

    // Remove the intermediate .ts files now that .js and .d.ts have been produced
    for (const file of files) {
      await unlink(join(outputDir, file.filename))
      const jsFilename = file.filename.replace(/\.ts$/, '.js')
      const dtsFilename = file.filename.replace(/\.ts$/, '.d.ts')
      console.log(`Built: ${jsFilename}`)
      console.log(`Built: ${dtsFilename}`)
    }

    console.log(`\nTotal files built: ${files.length * 2}`)
  } else {
    console.log(`\nTotal files generated: ${files.length}`)
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
