import type { AsyncApiModel, ChannelContract, ContractDirection, ExtractionIssue } from '@amritk/asyncapi'
import { buildChannelContract, sanitizeToken } from '@amritk/asyncapi'

import type { OutputWriter } from './create-output-writer'

/** Subdirectory of the output root the contract modules land in. */
export const CONTRACTS_DIR = 'contracts'

/** The package the generated modules import `defineMessages` from. */
export const CONTRACTS_PEER = '@amritk/api'

export type EmitMessageContractsOptions = {
  readonly model: AsyncApiModel
  readonly writer: OutputWriter
  /** Fallback discriminator for channels that do not declare one (`--discriminator`). */
  readonly discriminator?: string
  /** Header comment prepended to each file, when `--banner` asked for one. */
  readonly bannerPrefix?: string
}

export type EmitMessageContractsResult = {
  /** Paths staged on the writer, relative to its root, in the order they were staged. */
  readonly files: readonly string[]
  /** Everything a channel could not project, for the caller to warn about. */
  readonly issues: readonly ExtractionIssue[]
  /** How many messages made it into a contract, across every channel. */
  readonly messageCount: number
  /** How many channels got a contract module (the barrel is not one of them). */
  readonly channelCount: number
}

/**
 * Renders one direction's message map. Schemas go out as `JSON.stringify`d
 * literals with `as const` on each: `defineMessages` captures its argument with
 * `const` type parameters, and the assertion is what keeps that intact if the
 * emitted object is ever pulled out into a named variable or spread — the
 * literal types are the whole reason the derived union narrows.
 */
const renderDirection = (name: string, direction: ContractDirection, indent: string): string => {
  const entries = Object.entries(direction).map(([messageName, schema]) => {
    // The schema's own indentation is re-based onto the emitted nesting level,
    // so a deep payload does not sit flush against the left margin.
    const literal = JSON.stringify(schema, null, 2).replaceAll('\n', `\n${indent}  `)
    return `${indent}  ${JSON.stringify(messageName)}: ${literal} as const,`
  })
  return `${indent}${name}: {\n${entries.join('\n')}\n${indent}},`
}

/** Renders one channel's module: the header, the import, and the `defineMessages` call. */
const renderChannelModule = (contract: ChannelContract, channel: { key: string; address?: string }): string => {
  const directions = [
    Object.keys(contract.clientToServer).length > 0
      ? renderDirection('clientToServer', contract.clientToServer, '  ')
      : undefined,
    Object.keys(contract.serverToClient).length > 0
      ? renderDirection('serverToClient', contract.serverToClient, '  ')
      : undefined,
  ].filter((entry) => entry !== undefined)

  const address = channel.address !== undefined && channel.address !== channel.key ? ` (${channel.address})` : ''
  return [
    '/**',
    ` * Message contract for the AsyncAPI channel \`${channel.key}\`${address}.`,
    ' *',
    ` * Requires \`${CONTRACTS_PEER}\` at runtime — it is a peer dependency of this`,
    ' * generated code, not of the mjst CLI that wrote it. Install it in the project',
    ' * that imports this file.',
    ' *',
    ' * Message keys are the wire discriminator values: a frame',
    ` * \`{ "${contract.discriminator}": "<key>", ... }\` selects its schema by that key, and the`,
    ' * tag is removed before the payload below is validated — which is why no',
    ' * payload here declares it.',
    ' */',
    `import { defineMessages } from '${CONTRACTS_PEER}'`,
    '',
    `export const ${contract.exportName} = defineMessages({`,
    `  discriminator: '${contract.discriminator}',`,
    ...directions,
    '})',
    '',
  ].join('\n')
}

/**
 * Projects every channel of an AsyncAPI document onto a `defineMessages`
 * contract and stages one module per channel under `contracts/`, plus a barrel.
 *
 * These are *runtime values*, not types — which is why the flag that asks for
 * them refuses `--types-only`, and why the generated files import
 * `@amritk/api`. That import is the consumer's dependency to satisfy: the CLI
 * needs the package to have been written, not to be installed where the output
 * lands, and pinning it as a hard dependency of generated code would drag a
 * server framework into projects that only wanted the schemas.
 *
 * A channel that projects to nothing (every message skipped, or a channel with
 * no messages at all) is not written: an exported contract with no messages
 * accepts no frame in either direction, which is a trap rather than a document.
 * The reasons come back in {@link EmitMessageContractsResult.issues}.
 *
 * The barrel's specifiers are always `.ts`, ignoring `--import-ext`: these
 * modules are the one part of the output `--build` leaves uncompiled (they
 * import the `@amritk/api` peer, and handing tsc an import the output's project
 * has not installed would fail the parsers' compilation too). A `.js` specifier
 * would then name a file this run never wrote.
 */
export const emitMessageContracts = async (
  options: EmitMessageContractsOptions,
): Promise<EmitMessageContractsResult> => {
  const { model, writer, bannerPrefix = '' } = options

  const issues: ExtractionIssue[] = []
  const files: string[] = []
  const barrel: string[] = []
  const takenTokens = new Set<string>()
  const takenExports = new Set<string>()
  let messageCount = 0

  for (const channel of model.channels) {
    const contract = buildChannelContract(channel, {
      ...(options.discriminator !== undefined ? { discriminator: options.discriminator } : {}),
    })
    issues.push(...contract.issues)

    const count = Object.keys(contract.clientToServer).length + Object.keys(contract.serverToClient).length
    if (count === 0) {
      issues.push({
        path: `#/channels/${channel.key}`,
        message: 'no message projected onto a contract; no contract module written for this channel',
      })
      continue
    }
    messageCount += count

    // Two channels whose keys sanitize alike must not share a module — or an
    // export name, since the barrel re-exports both from one place. The
    // parser tree dedupes the same way, for the same reason.
    const token = claim(sanitizeToken(channel.key, 'channel'), takenTokens, '-')
    // No dash in the export suffix: `lobbyMessages-2` is a filename, not an
    // identifier, and this one has to compile.
    const exportName = claim(contract.exportName, takenExports, '')
    if (exportName !== contract.exportName) {
      issues.push({
        path: `#/channels/${channel.key}`,
        message: `contract export name "${contract.exportName}" already claimed; using "${exportName}"`,
      })
    }

    const filename = `${CONTRACTS_DIR}/${token}.ts`
    await writer.stage(filename, bannerPrefix + renderChannelModule({ ...contract, exportName }, channel))
    files.push(filename)
    barrel.push(`export { ${exportName} } from './${token}.ts'`)
  }

  if (barrel.length > 0) {
    const filename = `${CONTRACTS_DIR}/index.ts`
    await writer.stage(filename, `${bannerPrefix + barrel.join('\n')}\n`)
    files.push(filename)
  }

  return { files, issues, messageCount, channelCount: barrel.length }
}

/** Claims `base`, or the first free `<base><separator>2`, `…3`, … variant of it. */
const claim = (base: string, taken: Set<string>, separator: string): string => {
  let candidate = base
  for (let n = 2; taken.has(candidate); n++) {
    candidate = `${base}${separator}${n}`
  }
  taken.add(candidate)
  return candidate
}
