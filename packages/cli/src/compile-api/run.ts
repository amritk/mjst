import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { type CompileModuleOptions, compileToModule } from '@amritk/api'

import type { RunResult } from '../lint/run'
import { collectRouteContracts } from './collect-route-contracts'
import { defaultRoutesImport } from './default-routes-import'
import { COMPILE_API_HELP_TEXT } from './help-text'
import { loadRoutesModule } from './load-routes-module'
import { parseCompileApiArgs } from './parse-compile-api-args'
import { readCompileOptions } from './read-compile-options'

// Exit code 2 marks a usage error (bad flags, missing --out) and 1 a failed
// compilation — the same split the lint subcommand uses.
const usageError = (message: string): RunResult => ({ code: 2, stdout: '', stderr: `Error: ${message}\n` })

const failure = (message: string): RunResult => ({ code: 1, stdout: '', stderr: `Error: ${message}\n` })

/**
 * Runs `mjst compile-api` over `argv`: loads the routes module, collects its
 * route-contract exports, compiles them with `compileToModule`, and writes
 * the emitted module to `--out`. Returns the exit code and the text it would
 * print (rather than writing to the process streams) so tests can drive it
 * in-process — the same shape as the lint subcommand's `run`.
 */
export const run = async (argv: string[]): Promise<RunResult> => {
  let args: ReturnType<typeof parseCompileApiArgs>
  try {
    args = parseCompileApiArgs(argv)
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error))
  }

  if (args.help || argv.length === 0) {
    return { code: 0, stdout: COMPILE_API_HELP_TEXT, stderr: '' }
  }

  if (args.routesModule === undefined) {
    return usageError('A routes module path is required. Usage: mjst compile-api <routes-module> --out <file>')
  }
  if (args.out === undefined) {
    return usageError('--out is required. Provide an output file for the generated module.')
  }

  const modulePath = resolve(args.routesModule)
  let moduleExports: Record<string, unknown>
  try {
    moduleExports = await loadRoutesModule(modulePath)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }

  const routes = collectRouteContracts(moduleExports)
  const routeNames = Object.keys(routes)
  if (routeNames.length === 0) {
    return failure(
      `No route contracts found in ${modulePath}. ` +
        'A route contract is a named export declaring method, path, and responses.',
    )
  }

  let fileOptions: Partial<CompileModuleOptions> = {}
  if (args.optionsFile !== undefined) {
    try {
      fileOptions = await readCompileOptions(resolve(args.optionsFile))
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
  }

  const outFile = resolve(args.out)
  const routesImport = args.routesImport ?? defaultRoutesImport(outFile, modulePath)

  let source: string
  try {
    // Flags overlay the options file, and the CLI-owned keys (routesImport,
    // routes) always win — the same precedence the generate flow gives CLI
    // flags over its config file.
    source = compileToModule({
      ...fileOptions,
      ...(args.openApiPath !== undefined ? { openApiPath: args.openApiPath } : {}),
      ...(args.maxBodyBytes !== undefined ? { maxBodyBytes: args.maxBodyBytes } : {}),
      routesImport,
      routes,
    })
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }

  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, source, 'utf-8')

  const stdout = [
    `Compiled ${routeNames.length} route(s): ${routeNames.join(', ')}`,
    `Generated: ${relative(process.cwd(), outFile)}`,
    '',
  ].join('\n')
  return { code: 0, stdout, stderr: '' }
}
